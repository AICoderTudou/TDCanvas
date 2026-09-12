import { AITUDOU_OPERATIONS, getAitudouOperation, type AitudouOperationDefinition, type AitudouOutputKind, type AitudouTaskFamily } from "./aitudou-contract";
import { getAitudouModelProfile, type AitudouModelFamily } from "./aitudou-models";
import { extractAitudouCreateTaskIds, extractAitudouOutputs, parseAitudouSse, pollPathForAitudouTask, normalizeAitudouTaskResponse, type AitudouOutput, type AitudouTaskState } from "./aitudou-protocol";
import { isDesktopAssetUrl, isTauriRuntime, platformFetch, readDesktopFileBlob } from "@/services/platform/desktop-runtime";

export const AITUDOU_OFFICIAL_BASE_URL = "https://api.aitudou.net";
export const AITUDOU_LOCAL_PROXY_PREFIX = "/tdtv-api/aitudou";

export type AitudouReference = {
    kind: "image" | "video" | "audio" | "text" | "task";
    name: string;
    url?: string;
    text?: string;
    storageKey?: string;
    localPath?: string;
    mimeType?: string;
    taskId?: string;
    audioIndex?: number;
    selectionIndex?: number;
};

export type AitudouRequestConfig = {
    apiKey: string;
    baseUrl?: string;
};

export type AitudouRunOptions = {
    signal?: AbortSignal;
    references?: AitudouReference[];
    fetchImpl?: typeof fetch;
    pollIntervalMs?: number;
    timeoutMs?: number;
    onSubmitted?: (submission: AitudouSubmission) => void;
    onUpdate?: (state: AitudouTaskState) => void;
};

export type AitudouSubmission = {
    operationId: string;
    family: AitudouTaskFamily;
    taskId: string;
    pollPath: string;
    remoteRunning: true;
    raw: unknown;
};

export type AitudouRunResult = {
    operationId: string;
    status: "succeeded" | "attention" | "partial";
    taskIds: string[];
    outputs: AitudouOutput[];
    raw: unknown;
    taskStates: AitudouTaskState[];
};

export type AitudouRegistryCheck = {
    ok: boolean;
    music: AitudouRegistryDiff;
    midjourney: AitudouRegistryDiff;
};

export type AitudouRegistryDiff = {
    expected: string[];
    actual: string[];
    missing: string[];
    unexpected: string[];
    contractMismatches: string[];
    documentedConflicts: string[];
};

export class AitudouApiError extends Error {
    readonly status: number;
    readonly code?: string | number;
    readonly retryAfterMs?: number;
    readonly details: string;

    constructor(message: string, options: { status?: number; code?: string | number; retryAfterMs?: number; details?: string } = {}) {
        super(message);
        this.name = "AitudouApiError";
        this.status = options.status ?? 0;
        this.code = options.code;
        this.retryAfterMs = options.retryAfterMs;
        this.details = options.details || message;
    }
}

export type AitudouErrorDescription = {
    summary: string;
    details: string;
};

export function describeAitudouError(error: unknown, context: { operationId?: string; payload?: Record<string, unknown>; taskIds?: string[] } = {}, fallback = "Aitudou 请求失败"): AitudouErrorDescription {
    const summary = redact(error instanceof Error && error.message.trim() ? error.message : fallback);
    const contextLines = [context.operationId ? `操作：${context.operationId}` : "", context.taskIds?.length ? `Task ID：${context.taskIds.join(", ")}` : ""].filter(Boolean);
    const sections = [contextLines.join("\n")];
    if (context.payload) sections.push(`画布提交参数：\n${diagnosticJson(context.payload)}`);
    sections.push(error instanceof AitudouApiError ? error.details : summary);
    return { summary, details: sections.filter(Boolean).join("\n\n") };
}

export class AitudouPollingStoppedError extends Error {
    readonly submission: AitudouSubmission;
    readonly remoteContinues = true;

    constructor(submission: AitudouSubmission) {
        super("已停止本地轮询；Aitudou 远端任务仍会继续执行，并可能继续计费。可稍后从此节点恢复查询。");
        this.name = "AitudouPollingStoppedError";
        this.submission = submission;
    }
}

export async function runAitudouOperation(config: AitudouRequestConfig, operationId: string, payloadInput: string | Record<string, unknown>, options: AitudouRunOptions = {}): Promise<AitudouRunResult> {
    const operation = getAitudouOperation(operationId);
    if (operation.id !== operationId) throw new Error(`未知 Aitudou 操作：${operationId}`);
    const fetchImpl = options.fetchImpl || platformFetch;
    const references = options.references || [];
    const payload = parsePayload(payloadInput);
    const prepared = await prepareAitudouPayload(config, operation, payload, references, fetchImpl, options.signal);
    const validationPayload = operation.requestMode === "multipart-upload" || operation.requestMode === "multipart-transcription" ? { ...prepared, file: prepared.file || "__canvas_connected_file__" } : prepared;
    validateAitudouPayload(operation, validationPayload);

    if (operation.requestMode === "multipart-upload") {
        const reference = firstReference(references, ["image", "video", "audio"]);
        if (!reference) throw new Error("上传参考素材需要连接一个图片、视频或音频节点。");
        const uploaded = await uploadAitudouReference(config, reference, fetchImpl, options.signal);
        return immediateResult(operationId, [{ kind: "text", text: uploaded.url, url: uploaded.url, metadata: uploaded as unknown as Record<string, unknown> }], uploaded.raw);
    }

    let body: BodyInit | undefined;
    const headers: Record<string, string> = { Accept: "application/json, text/event-stream, text/plain" };
    if (operation.requestMode === "multipart-transcription") {
        const reference = firstReference(references, ["audio"]);
        if (!reference) throw new Error("语音转写需要连接一个音频节点。");
        const blob = await referenceBlob(reference, fetchImpl);
        validateUploadBlob(blob, reference.name, true);
        const form = new FormData();
        form.append("file", blob, reference.name || fileNameForBlob(blob, "audio"));
        Object.entries(prepared).forEach(([key, value]) => {
            if (key !== "file") appendFormValue(form, key, value);
        });
        body = form;
    } else if (operation.requestMode === "json") {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(prepared);
    }

    const raw = await requestAitudou(config, operation.path, { method: operation.method, headers, body, signal: options.signal }, fetchImpl);
    if (typeof raw === "object" && raw && "__sse" in raw) {
        const sse = raw as { __sse: true; text: string; content: string; reasoning: string };
        return immediateResult(operationId, [{ kind: "text", text: sse.text }], sse);
    }
    if (!operation.taskFamily) {
        const outputs = typeof raw === "string" ? [{ kind: "text" as const, text: raw }] : extractAitudouOutputs(raw, operation.outputHint);
        return immediateResult(operationId, outputs, raw);
    }

    const taskIds = extractAitudouCreateTaskIds(operation.taskFamily, raw);
    const immediateOutputs = extractAitudouOutputs(raw, operation.outputHint);
    if (!taskIds.length) {
        if (operation.sync || immediateOutputs.length) return immediateResult(operationId, immediateOutputs.length ? immediateOutputs : [{ kind: "text", text: prettyJson(raw) }], raw);
        throw new Error("Aitudou 已接受请求，但响应中没有文档规定的 task_id，无法安全轮询。原始响应已保留在节点错误详情中。");
    }

    const submissions = taskIds.map(
        (taskId): AitudouSubmission => ({
            operationId,
            family: operation.taskFamily!,
            taskId,
            pollPath: pollPathForAitudouTask(operation.taskFamily!, taskId),
            remoteRunning: true,
            raw,
        }),
    );
    submissions.forEach((submission) => options.onSubmitted?.(submission));

    return settleAitudouSubmissions(config, operationId, submissions, operation.outputHint, fetchImpl, options);
}

export async function runAitudouOperationBatch(config: AitudouRequestConfig, operationId: string, payloadInput: string | Record<string, unknown>, batchCount: number, options: AitudouRunOptions = {}): Promise<AitudouRunResult> {
    if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > 4) throw new Error("画布批量生成数量必须是 1–4 的整数。");
    if (batchCount === 1) return runAitudouOperation(config, operationId, payloadInput, options);

    const submissions = new Map<string, AitudouSubmission>();
    const latestStates = new Map<string, AitudouTaskState>();
    const batchOptions: AitudouRunOptions = {
        ...options,
        onSubmitted: (submission) => {
            submissions.set(submission.taskId, submission);
            options.onSubmitted?.(submission);
        },
        onUpdate: (state) => {
            latestStates.set(state.taskId, state);
            options.onUpdate?.(state);
        },
    };
    const settled = await Promise.allSettled(Array.from({ length: batchCount }, () => runAitudouOperation(config, operationId, payloadInput, batchOptions)));
    const completed = settled.filter((item): item is PromiseFulfilledResult<AitudouRunResult> => item.status === "fulfilled").map((item) => item.value);
    const rejected = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (!completed.length) {
        const stopped = rejected.find((item) => item.reason instanceof AitudouPollingStoppedError);
        throw stopped?.reason || rejected[0]?.reason || new Error("批量生成没有返回可用结果。");
    }

    const stateByTaskId = new Map<string, AitudouTaskState>();
    completed.flatMap((result) => result.taskStates).forEach((state) => stateByTaskId.set(state.taskId, state));
    latestStates.forEach((state, taskId) => {
        if (!stateByTaskId.has(taskId)) stateByTaskId.set(taskId, state);
    });
    submissions.forEach((submission, taskId) => {
        if (stateByTaskId.has(taskId)) return;
        stateByTaskId.set(taskId, {
            family: submission.family,
            taskId,
            phase: "running",
            status: "polling_interrupted",
            message: "该批次的本地查询中断，远端任务可能仍在执行并计费。",
            raw: { pollingInterrupted: true },
        });
    });
    const taskStates = Array.from(stateByTaskId.values());
    const taskIds = Array.from(new Set([...completed.flatMap((result) => result.taskIds), ...submissions.keys()]));
    const partial = rejected.length > 0 || completed.some((result) => result.status === "partial") || taskStates.some((state) => state.phase === "failed" || state.status === "polling_interrupted");
    const attention = completed.some((result) => result.status === "attention");
    return {
        operationId,
        status: partial ? "partial" : attention ? "attention" : "succeeded",
        taskIds,
        outputs: completed.flatMap((result) => result.outputs),
        raw: {
            batchResults: completed.map((result) => result.raw),
            batchErrors: rejected.map((item) => (item.reason instanceof Error ? item.reason.message : String(item.reason))),
        },
        taskStates,
    };
}

export async function resumeAitudouTask(config: AitudouRequestConfig, operationId: string, taskId: string, options: AitudouRunOptions = {}): Promise<AitudouRunResult> {
    return resumeAitudouTasks(config, operationId, [taskId], options);
}

export async function resumeAitudouTasks(config: AitudouRequestConfig, operationId: string, taskIds: string[], options: AitudouRunOptions = {}): Promise<AitudouRunResult> {
    const operation = getAitudouOperation(operationId);
    if (operation.id !== operationId || !operation.taskFamily) throw new Error(`操作 ${operationId} 不是可轮询的 Aitudou 任务。`);
    const uniqueTaskIds = Array.from(
        new Set(
            taskIds
                .map(String)
                .map((value) => value.trim())
                .filter(Boolean),
        ),
    );
    if (!uniqueTaskIds.length) throw new Error(`操作 ${operationId} 没有可恢复查询的 Task ID。`);
    const submissions = uniqueTaskIds.map(
        (taskId): AitudouSubmission => ({
            operationId,
            family: operation.taskFamily!,
            taskId,
            pollPath: pollPathForAitudouTask(operation.taskFamily!, taskId),
            remoteRunning: true,
            raw: null,
        }),
    );
    return settleAitudouSubmissions(config, operationId, submissions, operation.outputHint, options.fetchImpl || platformFetch, options);
}

export async function checkAitudouActionRegistries(config: AitudouRequestConfig = { apiKey: "" }, fetchImpl: typeof fetch = platformFetch): Promise<AitudouRegistryCheck> {
    const [musicRaw, midjourneyRaw] = await Promise.all([
        requestAitudou(config, "/api/music/actions", { method: "GET", headers: { Accept: "application/json" } }, fetchImpl, false),
        requestAitudou(config, "/api/midjourney/actions", { method: "GET", headers: { Accept: "application/json" } }, fetchImpl, false),
    ]);
    const expectedMusic = getExpectedActions("suno");
    const expectedMidjourney = getExpectedActions("midjourney");
    const music = registryDiff("suno", expectedMusic, musicRaw, "");
    const midjourney = registryDiff("midjourney", expectedMidjourney, midjourneyRaw, "imagine");
    return {
        ok: [music, midjourney].every((diff) => !diff.missing.length && !diff.unexpected.length && !diff.contractMismatches.length),
        music,
        midjourney,
    };
}

export function resolveAitudouApiBase(baseUrl = "") {
    const configured = normalizeRootBaseUrl(baseUrl || AITUDOU_OFFICIAL_BASE_URL);
    if (typeof window !== "undefined" && !isTauriRuntime() && configured === AITUDOU_OFFICIAL_BASE_URL) return AITUDOU_LOCAL_PROXY_PREFIX;
    return configured;
}

export async function prepareAitudouPayload(config: AitudouRequestConfig, operation: AitudouOperationDefinition, payload: Record<string, unknown>, references: AitudouReference[], fetchImpl: typeof fetch = platformFetch, signal?: AbortSignal) {
    const grouped = groupReferences(references);
    const uploaded = new Map<string, string>();
    const resolveValue = async (value: unknown): Promise<unknown> => {
        if (typeof value === "string") {
            const placeholder = parsePlaceholder(value);
            if (!placeholder) return value;
            const reference = grouped[placeholder.kind][placeholder.index - 1];
            if (!reference) throw new Error(`参数使用了 ${value}，但画布没有连接对应的第 ${placeholder.index} 个${placeholderLabel(placeholder.kind)}节点。`);
            if (placeholder.kind === "text") return reference.text || "";
            if (placeholder.kind === "task") {
                if (placeholder.field === "audioIndex") return reference.audioIndex || 1;
                if (placeholder.field === "selectionIndex") return reference.selectionIndex || 1;
                if (placeholder.field === "selectionZeroIndex") return Math.max(0, (reference.selectionIndex || 1) - 1);
                return reference.taskId || "";
            }
            const cacheKey = `${reference.kind}:${reference.storageKey || reference.url || reference.name}`;
            const cached = uploaded.get(cacheKey);
            if (cached) return cached;
            const result = await uploadAitudouReference(config, reference, fetchImpl, signal);
            uploaded.set(cacheKey, result.url);
            return result.url;
        }
        if (Array.isArray(value)) return Promise.all(value.map(resolveValue));
        if (value && typeof value === "object") {
            const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, child]) => [key, await resolveValue(child)] as const));
            return Object.fromEntries(entries);
        }
        return value;
    };
    const prepared = (await resolveValue(payload)) as Record<string, unknown>;
    if (operation.id === "text.chat") prepared.stream = Boolean(prepared.stream);
    return prepared;
}

export function validateAitudouPayload(operation: AitudouOperationDefinition, payload: Record<string, unknown>) {
    const missing = operation.requiredFields.filter((field) => isMissing(getPath(payload, field.split("."))));
    if (missing.length) throw new Error(`${operation.label}缺少必填参数：${missing.join("、")}`);

    if (operation.id === "text.chat") {
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const hasUserContent = messages.some((message) => {
            if (!message || typeof message !== "object") return false;
            const record = message as Record<string, unknown>;
            return record.role === "user" && !isMissing(record.content);
        });
        if (!hasUserContent) throw new Error("Kimi 文本对话按官方文档要求必须提供非空的用户消息内容。");
    }

    if (operation.id === "video.upscale") {
        const content = getPath(payload, ["metadata", "content"]);
        if (!Array.isArray(content) || content.length !== 1 || getPath(content[0], ["type"]) !== "video_url") throw new Error("视频超分要求 metadata.content 中恰好一个 video_url。");
    }
    if (operation.id === "video.generate") {
        const images = payload.images || payload.image;
        const content = getPath(payload, ["metadata", "content"]);
        if (!isMissing(images) && Array.isArray(content) && content.length) throw new Error("metadata.content 与顶层 images/image 不能同时发送；请只保留一种素材表达。");
        const model = String(payload.model || "");
        if (/(?:-t2v|-multi)$/.test(model) && isMissing(payload.prompt)) throw new Error(`${model} 按官方文档要求必须提供 prompt。`);
        if (/(?:-i2v|-start-end)$/.test(model) && isMissing(images) && isMissing(content)) throw new Error(`${model} 按官方文档要求必须连接参考图片。`);
    }
    if (operation.id === "audio.generate") {
        const speaker = getPath(payload, ["metadata", "speaker"]);
        const audio = getPath(payload, ["metadata", "audio_url"]) || getPath(payload, ["metadata", "audio_urls"]);
        const images = payload.images || payload.image;
        if ([speaker, audio, images].filter((item) => !isMissing(item)).length > 1) throw new Error("Seed Audio 的 speaker、参考音频、参考图片三类输入按官方文档互斥，只能使用一类。");
        const audioList = Array.isArray(audio) ? audio : isMissing(audio) ? [] : [audio];
        if (audioList.length > 3) throw new Error("Seed Audio 最多接收 3 个参考音频。");
        assertIntegerRange(getPath(payload, ["metadata", "speech_rate"]), "metadata.speech_rate", -50, 100);
        assertIntegerRange(getPath(payload, ["metadata", "loudness_rate"]), "metadata.loudness_rate", -50, 100);
        assertIntegerRange(getPath(payload, ["metadata", "pitch_rate"]), "metadata.pitch_rate", -12, 12);
    }
    if (operation.id === "image.generate") {
        const model = String(payload.model || "").toLowerCase();
        const isSeedream = model.includes("seedream");
        const width = getPath(payload, ["metadata", "width"]);
        const height = getPath(payload, ["metadata", "height"]);
        const hasWidth = !isMissing(width);
        const hasHeight = !isMissing(height);
        const outputFormat = getPath(payload, ["metadata", "output_format"]);
        if (!isMissing(outputFormat)) {
            if (!isSeedream) throw new Error("metadata.output_format 按官方文档仅适用于 Seedream 模型。");
            if (typeof outputFormat !== "string" || !["jpeg", "png"].includes(outputFormat.toLowerCase())) throw new Error("Seedream 的 metadata.output_format 只允许 jpeg 或 png。");
        }
        for (const field of ["width", "height"] as const) {
            const value = getPath(payload, ["metadata", field]);
            if (isMissing(value)) continue;
            if (!isSeedream) throw new Error(`metadata.${field} 按官方文档仅适用于 Seedream 模型。`);
            assertIntegerRange(value, `metadata.${field}`, 240, 8192);
        }
        if (isSeedream && hasWidth !== hasHeight) throw new Error("Seedream 的 metadata.width 与 metadata.height 必须成对提供。");
        if (isSeedream && hasWidth && !isMissing(getPath(payload, ["metadata", "resolution"]))) {
            throw new Error("Seedream 的 metadata.width/height 不能与 metadata.resolution 同时提供；resolution 会覆盖宽高，请只保留一种尺寸表达。");
        }
    }
    if (operation.id === "midjourney.imagine") {
        if (!isMissing(payload.speed) && (typeof payload.speed !== "string" || !["relax", "fast", "turbo"].includes(payload.speed.toLowerCase()))) {
            throw new Error("Midjourney 的 speed 只允许 relax、fast 或 turbo。");
        }
        if (!isMissing(payload.size) && (typeof payload.size !== "string" || !isPositiveAspectRatio(payload.size))) throw new Error("Midjourney 的 size 必须是正数宽高比 w:h。");
        if (!isMissing(payload.hd) && typeof payload.hd !== "boolean") throw new Error("Midjourney 的 hd 必须是布尔值。");
        if (!isMissing(payload.repeat) && (typeof payload.repeat !== "number" || !Number.isInteger(payload.repeat) || payload.repeat < 2 || payload.repeat > 40)) {
            throw new Error("Midjourney 的 repeat 只允许 2 到 40 的整数；生成 1 次时请省略该字段。");
        }
    }
    if (operation.id === "midjourney.blend") assertArrayRange(payload.image_urls, "image_urls", 2, 4);
    if (operation.id === "midjourney.describe") assertArrayRange(payload.image_urls, "image_urls", 1, 1);
    if (operation.id === "suno.mashup") assertArrayRange(payload.task_ids, "task_ids", 2, 2);
    if (operation.id === "suno.mashup" && !isMissing(payload.audio_indexes)) {
        assertArrayRange(payload.audio_indexes, "audio_indexes", 2, 2);
        if ((payload.audio_indexes as unknown[]).some((value) => typeof value !== "number" || !Number.isInteger(value) || value < 1)) throw new Error("audio_indexes 必须包含两个从 1 开始的整数音轨编号。");
    }

    const indexOrCustomActions = new Set(["midjourney.upscale", "midjourney.variation", "midjourney.high-variation", "midjourney.low-variation"]);
    if (indexOrCustomActions.has(operation.id) && isMissing(payload.index) && isMissing(payload.custom_id)) throw new Error(`${operation.label}需要 index 或 custom_id 之一。`);
    if (operation.id === "midjourney.pan" && isMissing(payload.direction) && isMissing(payload.custom_id)) throw new Error("Midjourney Pan 需要 direction 或 custom_id 之一。");
    if (operation.id === "midjourney.video" && isMissing(payload.task_id) && isMissing(payload.image_urls)) throw new Error("Midjourney Video 需要 task_id 或 image_urls 之一。");
    if (operation.id === "suno.generate" && isMissing(payload.prompt)) throw new Error("Suno 生成音乐按官方详细文档必须提供 prompt。");
    validateAitudouModelPayload(operation, payload);
}

function validateAitudouModelPayload(operation: AitudouOperationDefinition, payload: Record<string, unknown>) {
    const expectedFamily = operationModelFamily(operation.id);
    if (!expectedFamily) return;
    const modelId = String(payload.model || "").trim();
    if (!modelId) return;
    const profile = getAitudouModelProfile(modelId);
    if (!profile) throw new Error(`模型 ${modelId} 不在本次从 Aitudou 官方文档核对出的模型目录中；为避免猜测，已阻止提交。`);
    if (profile.family !== expectedFamily) throw new Error(`模型 ${modelId} 属于 ${profile.family}，不能用于 ${operation.label}。`);
    if (operation.id === "video.upscale" && profile.inputKind !== "video-upscale") throw new Error("视频超分节点只能使用官方 aitudou-upscaler 模型。");
    if (operation.id === "video.generate" && profile.inputKind === "video-upscale") throw new Error("aitudou-upscaler 请使用“视频超分”操作。");

    const topImages = Array.isArray(payload.images) ? payload.images.length : isMissing(payload.image) ? 0 : 1;
    const content = getPath(payload, ["metadata", "content"]);
    const contentItems = Array.isArray(content) ? content : [];
    const imageCount = topImages || contentItems.filter((item) => getPath(item, ["type"]) === "image_url").length;
    const videoCount = contentItems.filter((item) => getPath(item, ["type"]) === "video_url").length;
    const audioCount = contentItems.filter((item) => getPath(item, ["type"]) === "audio_url").length;
    if (profile.inputKind === "multi-reference-video" && !contentItems.length) throw new Error(`${modelId} 按官方文档要求 metadata.content 至少包含 1 个参考素材。`);
    if (profile.inputKind === "image-to-video" && imageCount < 1) throw new Error(`${modelId} 按官方文档要求至少提供 1 张参考图片。`);
    if (profile.inputKind === "reference-to-video" && topImages < 1) throw new Error(`${modelId} 按官方文档要求通过 images 或 image 提供至少 1 张参考图片。`);
    if ((profile.inputKind === "video-edit" || profile.inputKind === "motion-transfer") && isMissing(payload.video_url)) throw new Error(`${modelId} 按官方文档要求提供 video_url。`);
    if (profile.inputKind === "video-to-video") {
        if (isMissing(payload.prompt)) throw new Error(`${modelId} 按官方文档要求提供 prompt。`);
        if (isMissing(getPath(payload, ["metadata", "video_url"]))) throw new Error(`${modelId} 按官方文档要求提供 metadata.video_url。`);
    }
    if (profile.inputKind === "image-to-image" && topImages < 1) throw new Error(`${modelId} 按官方文档要求通过 images 或 image 提供至少 1 张参考图片。`);
    if (/^vidu-q3-(?:pro|turbo|pro-fast)-start-end$/.test(modelId) && topImages !== 2) throw new Error(`${modelId} 按官方文档要求恰好提供首、尾 2 张 images。`);
    if ((modelId === "flux-3-video-draft-enhance" || modelId === "flux-3-video-global-draft-enhance") && isMissing(getPath(payload, ["metadata", "draft_cache"]))) {
        throw new Error(`${modelId} 按官方文档要求提供 metadata.draft_cache。`);
    }
    if (modelId === "aitudou-video-g-omni-flash") {
        const videoUrl = getPath(payload, ["metadata", "video_url"]);
        const extendFromTaskId = getPath(payload, ["metadata", "extend_from_task_id"]);
        if (isMissing(payload.prompt) && imageCount < 1 && isMissing(videoUrl) && isMissing(extendFromTaskId)) throw new Error(`${modelId} 至少需要 prompt、images、metadata.video_url 或 metadata.extend_from_task_id 之一。`);
        if (!isMissing(videoUrl) && !isMissing(extendFromTaskId)) throw new Error(`${modelId} 的 metadata.video_url 与 metadata.extend_from_task_id 互斥。`);
        if (!isMissing(videoUrl) && typeof videoUrl !== "string") throw new Error(`${modelId} 的 metadata.video_url 必须是单个 URL 字符串。`);
        if (![payload.seconds, payload.duration, getPath(payload, ["metadata", "duration"])].every(isMissing)) throw new Error(`${modelId} 按官方文档不可指定时长。`);
    }
    if (/^hailuo-h3-(?:global-)?multi$/.test(modelId)) {
        const videoReferences = referenceCount(payload.video_url);
        const audioReferences = referenceCount(payload.audio_url);
        if (topImages + videoReferences + audioReferences < 1) throw new Error(`${modelId} 按官方文档至少需要 images、video_url 或 audio_url 中的一种参考素材。`);
        if (videoReferences > 3) throw new Error(`${modelId} 最多允许 3 个 video_url 参考。`);
        if (audioReferences > 3) throw new Error(`${modelId} 最多允许 3 个 audio_url 参考。`);
    }

    const constraints = profile.constraints;
    if (!constraints) return;
    const promptLength = typeof payload.prompt === "string" ? Array.from(payload.prompt).length : 0;
    if (constraints.minPromptLength !== undefined && promptLength < constraints.minPromptLength) throw new Error(`${modelId} 的 prompt 至少需要 ${constraints.minPromptLength} 个字符。`);
    if (constraints.maxPromptLength !== undefined && promptLength > constraints.maxPromptLength) throw new Error(`${modelId} 的 prompt 最多允许 ${constraints.maxPromptLength} 个字符。`);

    if (!isMissing(payload.seconds) && (typeof payload.seconds !== "string" || !/^\d+$/.test(payload.seconds.trim()))) throw new Error(`${modelId} 的 seconds 必须是明确的正整数字符串，例如 "5"。`);
    const seconds = Number(payload.seconds);
    if (!isMissing(payload.seconds) && constraints.seconds) {
        const allowed = constraints.seconds.values;
        if (allowed?.length && !allowed.includes(seconds)) throw new Error(`${modelId} 的 seconds 只允许：${allowed.join("、")}。`);
        if (constraints.seconds.min !== undefined && seconds < constraints.seconds.min) throw new Error(`${modelId} 的 seconds 不能小于 ${constraints.seconds.min}。`);
        if (constraints.seconds.max !== undefined && seconds > constraints.seconds.max) throw new Error(`${modelId} 的 seconds 不能大于 ${constraints.seconds.max}。`);
    }

    const resolution = getPath(payload, ["metadata", "resolution"]);
    if (!isMissing(resolution) && typeof resolution !== "string") throw new Error(`${modelId} 的 metadata.resolution 必须是字符串。`);
    if (!isMissing(resolution) && constraints.resolutions && !includesCaseInsensitive(constraints.resolutions, String(resolution))) throw new Error(`${modelId} 的 resolution 只允许：${constraints.resolutions.join("、")}。`);
    const ratio = getPath(payload, ["metadata", "ratio"]);
    if (!isMissing(ratio) && typeof ratio !== "string") throw new Error(`${modelId} 的 metadata.ratio 必须是字符串。`);
    if (!isMissing(ratio) && constraints.ratios && !includesCaseInsensitive(constraints.ratios, String(ratio))) {
        if (!constraints.allowCustomRatio || !isPositiveAspectRatio(String(ratio))) throw new Error(`${modelId} 的 ratio 只允许：${constraints.ratios.join("、")}${constraints.allowCustomRatio ? "，或合法的正数宽高比 w:h" : ""}。`);
    }
    const size = payload.size;
    if (!isMissing(size) && constraints.sizeRatios) {
        if (typeof size !== "string") throw new Error(`${modelId} 的 size 必须是比例字符串。`);
        const allowedSizeRatios = modelId === "aitudou-image-g-v2-lowprice" && String(resolution).toLowerCase() === "4k" ? constraints.sizeRatios.filter((value) => ["16:9", "9:16", "21:9", "9:21"].includes(value)) : constraints.sizeRatios;
        if (!includesCaseInsensitive(allowedSizeRatios, size)) throw new Error(`${modelId} 当前分辨率的 size 只允许：${allowedSizeRatios.join("、")}。`);
    }
    const format = getPath(payload, ["metadata", "format"]);
    if (!isMissing(format) && typeof format !== "string") throw new Error(`${modelId} 的 metadata.format 必须是字符串。`);
    if (!isMissing(format) && constraints.formats && !includesCaseInsensitive(constraints.formats, String(format))) throw new Error(`${modelId} 的 format 只允许：${constraints.formats.join("、")}。`);
    const sampleRate = getPath(payload, ["metadata", "sample_rate"]);
    if (!isMissing(sampleRate) && typeof sampleRate !== "string") throw new Error(`${modelId} 的 metadata.sample_rate 必须是字符串。`);
    if (!isMissing(sampleRate) && constraints.sampleRates && !constraints.sampleRates.map(String).includes(String(sampleRate))) throw new Error(`${modelId} 的 sample_rate 只允许：${constraints.sampleRates.join("、")}。`);

    if (constraints.maxImages !== undefined && imageCount > constraints.maxImages) throw new Error(`${modelId} 最多允许 ${constraints.maxImages} 个图片输入。`);
    if (constraints.maxVideos !== undefined && videoCount > constraints.maxVideos) throw new Error(`${modelId} 最多允许 ${constraints.maxVideos} 个视频输入。`);
    if (constraints.maxAudios !== undefined && audioCount > constraints.maxAudios) throw new Error(`${modelId} 最多允许 ${constraints.maxAudios} 个音频输入。`);
    if (constraints.maxReferences !== undefined && imageCount + videoCount + audioCount > constraints.maxReferences) throw new Error(`${modelId} 最多允许 ${constraints.maxReferences} 个参考素材。`);
    const outputValue = payload.n ?? getPath(payload, ["metadata", "n"]);
    if (!isMissing(outputValue)) {
        if (typeof outputValue !== "number" || !Number.isInteger(outputValue) || outputValue < 1) throw new Error(`${modelId} 的 n 必须是从 1 开始的整数。`);
        if (constraints.maxOutputs === undefined) throw new Error(`${modelId} 的官方文档未声明可配置 n，当前模型固定生成 1 个结果。`);
        if (outputValue > constraints.maxOutputs) throw new Error(`${modelId} 最多生成 ${constraints.maxOutputs} 个结果。`);
    }
}

function isPositiveAspectRatio(value: string) {
    const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return false;
    return Number(match[1]) > 0 && Number(match[2]) > 0;
}

function operationModelFamily(operationId: string): AitudouModelFamily | null {
    if (operationId === "video.generate" || operationId === "video.upscale") return "video";
    if (operationId === "image.generate") return "image";
    if (operationId === "audio.generate") return "audio";
    if (operationId === "text.chat") return "text";
    if (operationId === "audio.transcribe") return "transcription";
    return null;
}

async function settleAitudouSubmissions(config: AitudouRequestConfig, operationId: string, submissions: AitudouSubmission[], outputHint: AitudouOutputKind, fetchImpl: typeof fetch, options: AitudouRunOptions): Promise<AitudouRunResult> {
    const settled = await Promise.allSettled(submissions.map((submission) => pollAitudouSubmission(config, submission, outputHint, fetchImpl, options)));
    const states: AitudouTaskState[] = [];
    const interruptions: Array<{ submission: AitudouSubmission; error: unknown }> = [];
    settled.forEach((item, index) => {
        if (item.status === "fulfilled") states.push(item.value);
        else interruptions.push({ submission: submissions[index], error: item.reason });
    });
    const stopped = interruptions.find((item) => item.error instanceof AitudouPollingStoppedError);
    if (stopped) throw stopped.error;

    const productiveStates = states.filter((state) => state.phase === "succeeded" || state.phase === "attention");
    if (!productiveStates.length) {
        if (interruptions.length) throw interruptions[0].error;
        const failed = states.filter((state) => state.phase === "failed");
        const message = failed.map((state) => state.message || `${state.taskId}: ${state.status}`).join("；") || "Aitudou 任务执行失败。";
        throw new AitudouApiError(message, {
            code: failed[0]?.status,
            details: `任务执行失败\n\n${diagnosticJson(
                failed.map((state) => ({
                    taskId: state.taskId,
                    status: state.status,
                    message: state.message,
                    response: state.raw,
                })),
            )}`,
        });
    }

    const interruptedStates: AitudouTaskState[] = interruptions.map(({ submission, error }) => ({
        family: submission.family,
        taskId: submission.taskId,
        phase: "running",
        status: "polling_interrupted",
        message: error instanceof Error ? error.message : String(error),
        raw: { pollingInterrupted: true },
    }));
    const allStates = [...states, ...interruptedStates];
    const hasPartialFailure = states.some((state) => state.phase === "failed") || interruptions.length > 0;
    const attention = productiveStates.some((state) => state.phase === "attention");
    return {
        operationId,
        status: hasPartialFailure ? "partial" : attention ? "attention" : "succeeded",
        taskIds: submissions.map((submission) => submission.taskId),
        outputs: productiveStates.flatMap((state) => extractAitudouOutputs(state.raw, outputHint, state.taskId)),
        raw: allStates.length === 1 ? allStates[0].raw : allStates.map((state) => state.raw),
        taskStates: allStates,
    };
}

async function pollAitudouSubmission(config: AitudouRequestConfig, submission: AitudouSubmission, _outputHint: AitudouOutputKind, fetchImpl: typeof fetch, options: AitudouRunOptions) {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
    const pollIntervalMs = options.pollIntervalMs ?? 4000;
    while (Date.now() - startedAt <= timeoutMs) {
        if (options.signal?.aborted) throw new AitudouPollingStoppedError(submission);
        let raw: unknown;
        try {
            raw = await requestAitudou(config, submission.pollPath, { method: "GET", headers: { Accept: "application/json" }, signal: options.signal }, fetchImpl);
        } catch (error) {
            if (isAbortError(error)) throw new AitudouPollingStoppedError(submission);
            if (error instanceof AitudouApiError && (error.status === 429 || error.status >= 500)) {
                await delay(error.retryAfterMs ?? pollIntervalMs, options.signal, submission);
                continue;
            }
            throw error;
        }
        const state = normalizeAitudouTaskResponse(submission.family, submission.taskId, raw);
        options.onUpdate?.(state);
        if (state.phase === "succeeded" || state.phase === "attention") return state;
        if (state.phase === "failed") return state;
        await delay(pollIntervalMs, options.signal, submission);
    }
    throw new Error(`Aitudou 任务 ${submission.taskId} 轮询超过 ${Math.round(timeoutMs / 60000)} 分钟；远端任务可能仍在执行，可稍后恢复查询。`);
}

async function uploadAitudouReference(config: AitudouRequestConfig, reference: AitudouReference, fetchImpl: typeof fetch, signal?: AbortSignal) {
    if (canReuseExternalReference(reference)) return { url: reference.url!, expiresIn: undefined, raw: { url: reference.url, reused: true } };
    const blob = await referenceBlob(reference, fetchImpl);
    validateUploadBlob(blob, reference.name);
    const form = new FormData();
    form.append("file", blob, reference.name || fileNameForBlob(blob, reference.kind));
    const raw = await requestAitudou(config, "/v1/files/upload", { method: "POST", headers: { Accept: "application/json" }, body: form, signal }, fetchImpl);
    const url = findCanonicalUploadUrl(raw);
    if (!url) throw new Error("Aitudou 上传响应中缺少文档规定的 url 字段。");
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return { url, expiresIn: numberValue(record.expires_in), raw };
}

async function referenceBlob(reference: AitudouReference, fetchImpl: typeof fetch) {
    let blob: Blob | null = null;
    try {
        if (reference.storageKey?.startsWith("image:")) {
            const { getImageBlob } = await import("@/services/image-storage");
            blob = await getImageBlob(reference.storageKey);
        } else if (reference.storageKey) {
            const { getMediaBlob } = await import("@/services/file-storage");
            blob = await getMediaBlob(reference.storageKey);
        }
    } catch {
        blob = null;
    }
    if (!blob && reference.localPath) {
        try {
            blob = await readDesktopFileBlob(reference.localPath, reference.mimeType);
        } catch {
            blob = null;
        }
    }
    if (!blob && reference.url) {
        const response = await fetchImpl(reference.url);
        if (!response.ok) {
            if (response.status === 404 || response.status === 410) throw new Error(`引用素材“${reference.name}”的原地址已失效，且未找到可用的本地副本。请重新上传该素材后再生成。`);
            throw new Error(`无法读取画布素材 ${reference.name}（HTTP ${response.status}）。`);
        }
        blob = await response.blob();
    }
    if (!blob) throw new Error(`画布素材 ${reference.name} 的本地文件已丢失，无法上传。`);
    return blob;
}

function canReuseExternalReference(reference: AitudouReference) {
    const url = reference.url || "";
    if (!/^https?:\/\//i.test(url) || isDesktopAssetUrl(url)) return false;
    if (reference.storageKey || reference.localPath) return false;
    // Images returned by generation providers are commonly short-lived. Always
    // materialize and re-upload them so a task never depends on an old CDN URL.
    return reference.kind !== "image";
}

function validateUploadBlob(blob: Blob, name: string, transcription = false) {
    if (!transcription && blob.size > 50 * 1024 * 1024) throw new Error(`${name} 超过 Aitudou 上传上限 50MB。`);
    if (transcription) {
        const allowedExtensions = new Set(["mp3", "wav", "flac", "m4a", "mp4", "ogg", "opus", "aac", "aiff"]);
        const extension = name
            .split(/[?#]/)[0]
            .match(/\.([a-z0-9]+)$/i)?.[1]
            ?.toLowerCase();
        if (extension && !allowedExtensions.has(extension)) throw new Error(`${name} 的扩展名不在 Whisper 文档允许的 9 种格式中。`);
        const allowedMimeTypes = new Set([
            "audio/mpeg",
            "audio/mp3",
            "audio/wav",
            "audio/x-wav",
            "audio/flac",
            "audio/x-flac",
            "audio/mp4",
            "audio/m4a",
            "audio/x-m4a",
            "video/mp4",
            "audio/ogg",
            "application/ogg",
            "audio/opus",
            "audio/aac",
            "audio/x-aac",
            "audio/vnd.dlna.adts",
            "audio/aiff",
            "audio/x-aiff",
        ]);
        if (!extension && (!blob.type || !allowedMimeTypes.has(blob.type.toLowerCase()))) throw new Error(`${name} 缺少可识别的 Whisper 文件扩展名或 MIME 类型。`);
        return;
    }
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac", "video/mp4", "video/x-msvideo", "video/quicktime", "video/x-matroska"]);
    if (blob.type && !allowed.has(blob.type.toLowerCase())) throw new Error(`${name} 的格式 ${blob.type} 不在 Aitudou 文档允许列表中。`);
}

async function requestAitudou(config: AitudouRequestConfig, path: string, init: RequestInit, fetchImpl: typeof fetch, authenticated = true): Promise<unknown> {
    const apiKey = config.apiKey.trim();
    if (authenticated && !apiKey) throw new Error("请先在设置中填写 API_KEY。");
    const headers = new Headers(init.headers);
    if (authenticated) headers.set("Authorization", `Bearer ${apiKey}`);
    const response = await fetchImpl(`${resolveAitudouApiBase(config.baseUrl)}${path}`, { ...init, headers });
    const text = await response.text();
    if (!response.ok) {
        const parsed = parseJson(text);
        const message = extractErrorMessage(parsed) || httpStatusMessage(response.status);
        const code = extractErrorCode(parsed);
        const requestMethod = String(init.method || "GET").toUpperCase();
        const diagnosticSections = [
            `请求：${requestMethod} ${path}`,
            `HTTP 状态：${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
            code === undefined ? "" : `错误代码：${String(code)}`,
            `错误摘要：${message}`,
            diagnosticRequestBody(init.body),
            `服务端原始响应：\n${parsed === undefined ? redact(text || "[empty response]") : diagnosticJson(parsed)}`,
        ];
        throw new AitudouApiError(`${message}（HTTP ${response.status}）`, {
            status: response.status,
            code,
            retryAfterMs: parseRetryAfter(response.headers.get("Retry-After")),
            details: diagnosticSections.filter(Boolean).join("\n\n"),
        });
    }
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("text/event-stream") || /^\s*data:/m.test(text)) return { __sse: true, ...parseAitudouSse(text) };
    return parseJson(text) ?? text;
}

function parsePayload(input: string | Record<string, unknown>) {
    if (typeof input !== "string") return structuredClone(input);
    try {
        const value = JSON.parse(input) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        return value as Record<string, unknown>;
    } catch {
        throw new Error("Aitudou 参数必须是合法的 JSON 对象。");
    }
}

function immediateResult(operationId: string, outputs: AitudouOutput[], raw: unknown): AitudouRunResult {
    return { operationId, status: "succeeded", taskIds: [], outputs, raw, taskStates: [] };
}

function groupReferences(references: AitudouReference[]) {
    return {
        image: references.filter((item) => item.kind === "image"),
        video: references.filter((item) => item.kind === "video"),
        audio: references.filter((item) => item.kind === "audio"),
        text: references.filter((item) => item.kind === "text"),
        task: references.filter((item) => item.kind === "task"),
    };
}

function parsePlaceholder(value: string): { kind: AitudouReference["kind"]; index: number; field?: "audioIndex" | "selectionIndex" | "selectionZeroIndex" } | null {
    const match = value.match(/^@(Image|Video|Audio|Text|Task|TaskAudioIndex|TaskIndex|TaskZeroIndex)\s+(\d+)$/i);
    if (!match) return null;
    const raw = match[1].toLowerCase();
    const kind = raw === "taskaudioindex" || raw === "taskindex" || raw === "taskzeroindex" ? "task" : (raw as AitudouReference["kind"]);
    return {
        kind,
        index: Number(match[2]),
        field: raw === "taskaudioindex" ? "audioIndex" : raw === "taskindex" ? "selectionIndex" : raw === "taskzeroindex" ? "selectionZeroIndex" : undefined,
    };
}

function placeholderLabel(kind: AitudouReference["kind"]) {
    return { image: "图片", video: "视频", audio: "音频", text: "文本", task: "Aitudou 任务" }[kind];
}

function firstReference(references: AitudouReference[], kinds: AitudouReference["kind"][]) {
    return references.find((reference) => kinds.includes(reference.kind));
}

function appendFormValue(form: FormData, key: string, value: unknown) {
    if (value === undefined || value === null || value === "") return;
    form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
}

function findCanonicalUploadUrl(raw: unknown) {
    if (!raw || typeof raw !== "object") return "";
    const record = raw as Record<string, unknown>;
    if (typeof record.url === "string") return record.url;
    const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : undefined;
    return typeof data?.url === "string" ? data.url : "";
}

function registryRecords(raw: unknown, baseAlias: string) {
    const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
    const data = Array.isArray(root?.data) ? root.data : Array.isArray(raw) ? raw : [];
    return data
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : undefined))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item): Record<string, unknown> & { normalizedAction: string } => ({
            ...item,
            normalizedAction: typeof item.public_action === "string" ? item.public_action || baseAlias : "",
        }));
}

function getExpectedActions(group: "suno" | "midjourney") {
    const actions = AITUDOU_OPERATIONS.filter((operation) => operation.group === group).map((operation) => operation.id.split(".").slice(1).join("."));
    return group === "suno" ? actions.map((action) => (action === "generate" ? "" : action)) : actions;
}

function registryDiff(group: "suno" | "midjourney", expectedValues: string[], raw: unknown, baseAlias: string): AitudouRegistryDiff {
    const records = registryRecords(raw, baseAlias);
    const actualValues = records.map((record) => String(record.normalizedAction));
    const expected = Array.from(new Set(expectedValues)).sort();
    const actual = Array.from(new Set(actualValues)).sort();
    const contractMismatches: string[] = [];
    const documentedConflicts: string[] = [];
    expected.forEach((action) => {
        const operationId = `${group}.${group === "suno" && !action ? "generate" : action}`;
        const operation = getAitudouOperation(operationId);
        if (operation.id !== operationId) return;
        const record = records.find((item) => item.normalizedAction === action);
        if (!record) return;
        const actualRequired = Array.isArray(record.required_fields) ? record.required_fields.map(String).sort() : [];
        const expectedRequired = [...operation.requiredFields].sort();
        if (actualRequired.join("|") !== expectedRequired.join("|")) {
            const detail = `${operationId}.required_fields：本地 [${expectedRequired.join(", ")}] / registry [${actualRequired.join(", ")}]`;
            if (operationId === "midjourney.describe") documentedConflicts.push(`${detail}（registry 与正文冲突，运行时按正文要求单图）`);
            else contractMismatches.push(detail);
        }
        if (Boolean(record.sync) !== Boolean(operation.sync)) contractMismatches.push(`${operationId}.sync：本地 ${Boolean(operation.sync)} / registry ${Boolean(record.sync)}`);
        if (action && operation.path.split("/").pop() !== action && !(group === "midjourney" && action === "imagine") && !(group === "suno" && action === "")) {
            contractMismatches.push(`${operationId}.path 未使用 public_action`);
        }
    });
    return {
        expected,
        actual,
        missing: expected.filter((item) => !actual.includes(item)),
        unexpected: actual.filter((item) => !expected.includes(item)),
        contractMismatches,
        documentedConflicts,
    };
}

function normalizeRootBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, "").replace(/\/v1$/i, "") || AITUDOU_OFFICIAL_BASE_URL;
}

function isMissing(value: unknown) {
    return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
}

function referenceCount(value: unknown) {
    return Array.isArray(value) ? value.filter((item) => !isMissing(item)).length : isMissing(value) ? 0 : 1;
}

function assertArrayRange(value: unknown, field: string, min: number, max: number) {
    if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${field} 必须包含 ${min === max ? min : `${min}–${max}`} 项。`);
}

function assertIntegerRange(value: unknown, field: string, min: number, max: number) {
    if (isMissing(value)) return;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${field} 必须是 ${min} 到 ${max} 之间的整数。`);
}

function includesCaseInsensitive(values: readonly string[], value: string) {
    return values.some((item) => item.toLowerCase() === value.toLowerCase());
}

function getPath(value: unknown, path: string[]): unknown {
    let current = value;
    for (const key of path) {
        if (!current || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

function extractErrorMessage(value: unknown): string {
    if (!value || typeof value !== "object") return typeof value === "string" ? redact(value.trim()) : "";
    const record = value as Record<string, unknown>;
    for (const candidate of [record.message, record.msg, record.detail, record.error, getPath(record, ["data", "error"]), getPath(record, ["data", "message"]), getPath(record, ["data", "detail"]), record.fail_reason, record.failure_reason]) {
        const message = errorCandidateMessage(candidate);
        if (message) return message;
    }
    return "";
}

function errorCandidateMessage(value: unknown, depth = 0): string {
    if (depth > 4 || value === undefined || value === null) return "";
    if (typeof value === "string") return redact(value.trim());
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value))
        return value
            .map((item) => errorCandidateMessage(item, depth + 1))
            .filter(Boolean)
            .join("；");
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    const direct = errorCandidateMessage(record.message ?? record.msg, depth + 1);
    if (direct) {
        const location = Array.isArray(record.loc) ? record.loc.map(String).join(".") : "";
        return location ? `${location}: ${direct}` : direct;
    }
    for (const key of ["detail", "error", "reason", "fail_reason", "failure_reason"]) {
        const nested = errorCandidateMessage(record[key], depth + 1);
        if (nested) return nested;
    }
    return "";
}

function extractErrorCode(value: unknown) {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : undefined;
    const code = nested?.code ?? record.code;
    return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function redact(value: string) {
    return value.replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-***").replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer ***");
}

function diagnosticRequestBody(body: BodyInit | null | undefined) {
    if (typeof body !== "string" || !body.trim()) return "";
    const parsed = parseJson(body);
    return `实际请求参数：\n${parsed === undefined ? redact(body) : diagnosticJson(parsed)}`;
}

function diagnosticJson(value: unknown) {
    try {
        return JSON.stringify(
            value,
            (key, item) => {
                if (/^(authorization|api[_-]?key|token)$/i.test(key)) return "[已脱敏]";
                if (typeof item === "string") {
                    if (item.startsWith("data:") && item.length > 256) return `[data URL 已省略，${item.length} 字符]`;
                    return redact(item);
                }
                return typeof item === "bigint" ? item.toString() : item;
            },
            2,
        );
    } catch {
        return redact(String(value ?? ""));
    }
}

function httpStatusMessage(status: number) {
    const messages: Record<number, string> = {
        400: "请求参数无效",
        401: "API Key 无效或缺失",
        402: "账户余额不足",
        403: "没有调用此能力的权限",
        404: "任务或接口不存在",
        422: "内容审核未通过或参数无法处理",
        429: "请求过于频繁",
        500: "Aitudou 服务内部错误",
        502: "Aitudou 上游服务异常",
        503: "Aitudou 服务暂时不可用",
    };
    return messages[status] || "Aitudou 请求失败";
}

function parseRetryAfter(value: string | null) {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function parseJson(text: string) {
    if (!text.trim()) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

function numberValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function fileNameForBlob(blob: Blob, prefix: string) {
    const extension = blob.type.split("/")[1]?.replace("x-", "") || "bin";
    return `${prefix}.${extension}`;
}

function prettyJson(value: unknown) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value ?? "");
    }
}

function isAbortError(error: unknown) {
    return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}

function delay(ms: number, signal: AbortSignal | undefined, submission: AitudouSubmission) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new AitudouPollingStoppedError(submission));
            return;
        }
        const onAbort = () => {
            globalThis.clearTimeout(timer);
            reject(new AitudouPollingStoppedError(submission));
        };
        const timer = globalThis.setTimeout(
            () => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            },
            Math.max(0, ms),
        );
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
