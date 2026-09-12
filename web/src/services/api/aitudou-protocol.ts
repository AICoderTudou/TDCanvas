import type { AitudouOutputKind, AitudouTaskFamily } from "./aitudou-contract";

export type AitudouTaskPhase = "queued" | "running" | "succeeded" | "failed" | "attention";

export type AitudouTaskState = {
    family: AitudouTaskFamily;
    taskId: string;
    phase: AitudouTaskPhase;
    status: string;
    progress?: number;
    message?: string;
    raw: unknown;
};

export type AitudouOutput = {
    kind: AitudouOutputKind;
    url?: string;
    sourceUrl?: string;
    localPath?: string;
    text?: string;
    name?: string;
    filename?: string;
    mimeType?: string;
    taskId?: string;
    audioIndex?: number;
    selectionIndex?: number;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    persistenceError?: string;
    metadata?: Record<string, unknown>;
};

const SUCCESS_STATUSES = new Set(["SUCCESS", "SUCCEEDED", "COMPLETED", "COMPLETE", "DONE", "FINISHED"]);
const FAILURE_STATUSES = new Set(["FAIL", "FAILED", "FAILURE", "ERROR", "CANCELED", "CANCELLED"]);
const QUEUED_STATUSES = new Set(["NOT_START", "NOT_STARTED", "PENDING", "QUEUED", "SUBMITTED", "CREATED", "WAITING"]);
const RUNNING_STATUSES = new Set(["IN_PROGRESS", "PROCESSING", "RUNNING", "GENERATING", "STARTED"]);

export function normalizeAitudouTaskResponse(family: AitudouTaskFamily, taskId: string, raw: unknown): AitudouTaskState {
    assertAitudouEnvelope(raw);
    const body = responseBodyForFamily(family, raw);
    const status = readStatus(body) || readStatus(raw) || inferStatusFromResult(family, body);
    const normalized = status.toUpperCase().replace(/[\s-]+/g, "_");
    let phase: AitudouTaskPhase;
    if (family === "midjourney" && normalized === "MODAL") phase = "attention";
    else if (SUCCESS_STATUSES.has(normalized)) phase = "succeeded";
    else if (FAILURE_STATUSES.has(normalized)) phase = "failed";
    else if (RUNNING_STATUSES.has(normalized)) phase = "running";
    else if (QUEUED_STATUSES.has(normalized) || !normalized) phase = "queued";
    else phase = hasResultForFamily(family, body) ? "succeeded" : "running";

    return {
        family,
        taskId,
        phase,
        status: status || phase,
        progress: readProgress(body) ?? readProgress(raw),
        message: readMessage(body) || readMessage(raw),
        raw,
    };
}

export function extractAitudouCreateTaskIds(family: AitudouTaskFamily, raw: unknown) {
    assertAitudouEnvelope(raw);
    const root = asRecord(raw);
    const data = root?.data;
    const candidates: unknown[] = [];

    if (family === "video") {
        candidates.push(root?.id, root?.task_id, asRecord(data)?.id, asRecord(data)?.task_id);
    } else if (family === "image" || family === "audio") {
        for (const item of asArray(data)) candidates.push(asRecord(item)?.task_id, asRecord(item)?.id);
        candidates.push(asRecord(data)?.task_id, asRecord(data)?.id, root?.task_id, root?.id);
    } else if (family === "midjourney") {
        const body = firstObject(data) || root;
        candidates.push(body?.task_id, body?.id, root?.task_id, root?.id);
    } else {
        const body = firstObject(data) || root;
        candidates.push(body?.id, body?.task_id, root?.id, root?.task_id);
    }

    return Array.from(
        new Set(
            candidates
                .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
                .map(String)
                .filter(Boolean),
        ),
    );
}

export function assertAitudouEnvelope(raw: unknown): void {
    const body = asRecord(raw);
    if (!body) return;
    const code = body.code;
    const explicitFailure = code === false || (typeof code === "number" && code !== 0 && code !== 200) || (typeof code === "string" && ["error", "failed", "failure", "unauthorized", "forbidden"].includes(code.toLowerCase()));
    if (explicitFailure) throw new Error(readMessage(body) || `Aitudou API 返回错误代码：${String(code)}`);
}

export function extractAitudouOutputs(raw: unknown, outputHint: AitudouOutputKind, taskId?: string): AitudouOutput[] {
    const outputs: AitudouOutput[] = [];
    const seenUrls = new Set<string>();
    const root = asRecord(raw);
    const body = responseResultBody(raw);

    const addUrl = (url: unknown, kind = outputHint, metadata?: Record<string, unknown>, audioIndex?: number, selectionIndex?: number) => {
        if (typeof url !== "string" || !/^https?:\/\//i.test(url) || seenUrls.has(url)) return;
        seenUrls.add(url);
        outputs.push({ kind: inferOutputKind(url, kind), url, taskId, audioIndex, selectionIndex, metadata });
    };

    // Canonical response fields documented by Aitudou. Ordering is intentional: primary results first.
    addUrl(getPath(root, ["metadata", "url"]), "video");
    addUrl(getPath(root, ["metadata", "last_frame_url"]), "image", { role: "last-frame" });
    addUrl(getPath(body, ["result_url"]), outputHint);
    addUrl(getPath(body, ["grid_image_url"]), "image", { role: "grid" });

    const imageUrls = getPath(body, ["image_urls"]);
    if (Array.isArray(imageUrls)) imageUrls.forEach((url, index) => addUrl(url, "image", { index }, undefined, index + 1));

    const music = findFirstArrayByKey(raw, "music");
    music.forEach((item, index) => {
        const track = asRecord(item);
        if (!track) return;
        const metadata = compactRecord({
            id: track.id,
            title: track.title,
            duration: track.duration,
            image_url: track.image_url,
            tags: track.tags,
        });
        addUrl(track.audio_url || track.url, "audio", metadata, index + 1);
        addUrl(track.video_url, "video", metadata, index + 1);
        addUrl(track.image_url, "image", metadata, index + 1);
        addUrl(track.image_large_url, "image", metadata, index + 1);
    });

    for (const item of findContentItems(raw)) {
        const record = asRecord(item);
        if (!record) continue;
        const typedKind = contentTypeToKind(record.type, outputHint);
        addUrl(record.image_url || getPath(record, ["image_url", "url"]), typedKind);
        addUrl(record.video_url || getPath(record, ["video_url", "url"]), typedKind);
        addUrl(record.audio_url || getPath(record, ["audio_url", "url"]), typedKind);
        addUrl(record.file_url || record.url, typedKind);
    }

    // Action-specific files and media can use additional documented *_url fields.
    walkRecords(raw, (record, key, value) => {
        if (typeof value === "string" && /(?:^|_)(?:result|output|audio|video|image|file|download|midi)_?url$/i.test(key)) addUrl(value, keyToKind(key, outputHint));
        if (Array.isArray(value) && /(?:^|_)(?:result|output|audio|video|image|file|download|midi)_?urls$/i.test(key)) value.forEach((url) => addUrl(url, keyToKind(key, outputHint)));
    });

    const resultBody = responseResultBody(raw);
    const text = extractAitudouText(raw) || (outputHint === "text" ? stringValue(resultBody?.prompt) || stringValue(resultBody?.description) : "");
    if (text) outputs.push({ kind: "text", text, taskId });
    if (!outputs.length && outputHint === "text") outputs.push({ kind: "text", text: prettyJson(raw), taskId });
    return outputs;
}

export function extractAitudouText(raw: unknown): string {
    if (typeof raw === "string") return raw.trim();
    const root = asRecord(raw);
    if (!root) return "";
    const choice = asRecord(asArray(root.choices)[0]);
    const message = asRecord(choice?.message);
    const reasoning = stringValue(message?.reasoning_content);
    const content = stringValue(message?.content);
    if (reasoning || content) return [reasoning ? `思考过程：\n${reasoning}` : "", content].filter(Boolean).join("\n\n");

    const body = responseResultBody(raw);
    for (const key of ["text", "lyrics", "result", "content", "tags", "upsampled_tags", "description", "transcription"]) {
        const value = body?.[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

export function pollPathForAitudouTask(family: AitudouTaskFamily, taskId: string) {
    const encoded = encodeURIComponent(taskId);
    if (family === "video") return `/v1/videos/${encoded}`;
    if (family === "image") return `/v1/image/generations/${encoded}`;
    if (family === "audio") return `/v1/audio/generations/${encoded}`;
    if (family === "midjourney") return `/v1/midjourney/tasks/${encoded}`;
    return `/v1/music/tasks/${encoded}`;
}

export function parseAitudouSse(text: string) {
    let content = "";
    let reasoning = "";
    for (const block of text.split(/\r?\n\r?\n/)) {
        for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
                const chunk = JSON.parse(data) as Record<string, unknown>;
                const choice = asRecord(asArray(chunk.choices)[0]);
                const delta = asRecord(choice?.delta);
                content += stringValue(delta?.content);
                reasoning += stringValue(delta?.reasoning_content);
            } catch {
                // Ignore keep-alives and non-JSON SSE comments.
            }
        }
    }
    return { content, reasoning, text: [reasoning ? `思考过程：\n${reasoning}` : "", content].filter(Boolean).join("\n\n") };
}

function responseBodyForFamily(family: AitudouTaskFamily, raw: unknown) {
    const root = asRecord(raw);
    if (!root) return undefined;
    if (family === "video") return root;
    if (family === "image" || family === "audio") return firstObject(root.data) || root;
    return firstObject(root.data) || root;
}

function responseResultBody(raw: unknown) {
    const root = asRecord(raw);
    if (!root) return undefined;
    const data = firstObject(root.data) || asRecord(root.data) || root;
    return asRecord(data?.result) || data;
}

function inferStatusFromResult(family: AitudouTaskFamily, body?: Record<string, unknown>) {
    return body && hasResultForFamily(family, body) ? "SUCCESS" : "";
}

function hasResultForFamily(family: AitudouTaskFamily, body?: Record<string, unknown>) {
    if (!body) return false;
    if (family === "video") return Boolean(getPath(body, ["metadata", "url"]) || body.url);
    if (family === "image" || family === "audio") return Boolean(body.result_url || body.result);
    if (family === "midjourney") return Boolean(body.grid_image_url || body.image_urls || body.result);
    return Boolean(body.result || body.music || body.audio_url);
}

function readStatus(value: unknown) {
    const body = asRecord(value);
    for (const key of ["status", "state", "task_status"]) {
        const status = body?.[key];
        if (typeof status === "string") return status;
    }
    return "";
}

function readProgress(value: unknown) {
    const body = asRecord(value);
    for (const key of ["progress", "percentage", "percent"]) {
        const raw = body?.[key];
        const number = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace("%", "")) : Number.NaN;
        if (!Number.isFinite(number)) continue;
        return Math.max(0, Math.min(100, number <= 1 && number > 0 ? number * 100 : number));
    }
    return undefined;
}

function readMessage(value: unknown) {
    const body = asRecord(value);
    if (!body) return "";
    for (const key of ["error", "message", "msg", "fail_reason", "failure_reason"]) {
        const item = body[key];
        if (typeof item === "string" && item.trim()) return item.trim();
        const nested = asRecord(item);
        if (nested && typeof nested.message === "string") return nested.message;
    }
    return "";
}

function findContentItems(value: unknown) {
    return findFirstArrayByKey(value, "content");
}

function findFirstArrayByKey(value: unknown, target: string): unknown[] {
    let found: unknown[] = [];
    walkRecords(value, (record, key, child) => {
        if (!found.length && key === target && Array.isArray(child)) found = child;
    });
    return found;
}

function walkRecords(value: unknown, visitor: (record: Record<string, unknown>, key: string, value: unknown) => void, seen = new Set<object>()) {
    if (!value || typeof value !== "object" || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
        value.forEach((item) => walkRecords(item, visitor, seen));
        return;
    }
    const record = value as Record<string, unknown>;
    Object.entries(record).forEach(([key, child]) => {
        visitor(record, key, child);
        walkRecords(child, visitor, seen);
    });
}

function contentTypeToKind(type: unknown, fallback: AitudouOutputKind): AitudouOutputKind {
    const value = String(type || "").toLowerCase();
    if (value.includes("image")) return "image";
    if (value.includes("video")) return "video";
    if (value.includes("audio")) return "audio";
    if (value.includes("text")) return "text";
    return fallback;
}

function keyToKind(key: string, fallback: AitudouOutputKind): AitudouOutputKind {
    const value = key.toLowerCase();
    if (value.includes("image")) return "image";
    if (value.includes("video")) return "video";
    if (value.includes("audio")) return "audio";
    if (value.includes("midi") || value.includes("file") || value.includes("download")) return "file";
    return fallback;
}

function inferOutputKind(url: string, fallback: AitudouOutputKind): AitudouOutputKind {
    const path = url.split(/[?#]/)[0].toLowerCase();
    if (/\.(png|jpe?g|webp|gif|avif)$/.test(path)) return "image";
    if (/\.(mp4|webm|mov|mkv)$/.test(path)) return "video";
    if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(path)) return "audio";
    if (/\.(mid|midi|srt|vtt|zip)$/.test(path)) return "file";
    return fallback;
}

function firstObject(value: unknown) {
    if (Array.isArray(value)) return asRecord(value[0]);
    return asRecord(value);
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getPath(value: unknown, path: string[]): unknown {
    let current: unknown = value;
    for (const key of path) current = asRecord(current)?.[key];
    return current;
}

function compactRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function prettyJson(value: unknown) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value ?? "");
    }
}
