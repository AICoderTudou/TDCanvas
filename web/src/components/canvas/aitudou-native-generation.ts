import { AITUDOU_OPERATIONS, getAitudouOperation, type AitudouOperationDefinition } from "@/services/api/aitudou-contract";
import { AITUDOU_MODEL_PROFILES, getAitudouModelProfile, type AitudouModelInputKind, type AitudouModelProfile } from "@/services/api/aitudou-models";
import { validateAitudouPayload, type AitudouReference } from "@/services/api/aitudou";
import { CanvasNodeType, type CanvasNodeTypeId } from "@/types/canvas";

import {
    AITUDOU_SEEDREAM_ASPECT_RATIOS,
    AITUDOU_SEEDREAM_RESOLUTIONS,
    AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH,
    AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH,
    deriveAitudouSeedreamDimensions,
    inferAitudouSeedreamGeometry,
    isAitudouSeedreamVirtualPath,
} from "./aitudou-aspect-dimensions";

export type AitudouNativeNodeKind = "image" | "video" | "audio" | "text";

export type AitudouNativeReferenceCounts = Readonly<{
    image: number;
    video: number;
    audio: number;
    text: number;
    task: number;
}>;

export type AitudouNativeModelCapability = Readonly<{
    modeLabel: string;
    inputLabel: string;
    parameterLabel: string;
}>;

export type AitudouNativeParameterDefinition = Readonly<{
    path: string;
    label: string;
    control: "select" | "number" | "text" | "boolean" | "slider";
    options?: readonly { label: string; value: string | number | boolean }[];
    min?: number;
    max?: number;
    step?: number;
    optional?: boolean;
}>;

export type AitudouNativeOperationGroup = Readonly<{
    label: string;
    options: readonly { label: string; value: string; description: string }[];
}>;

export type AitudouNativeModelChoiceGroup = Readonly<{
    label: string;
    options: readonly { label: string; value: string }[];
}>;

export type AitudouNativeVideoModelChoice = Readonly<{
    label: string;
    value: string;
    group: string;
    capabilities: readonly string[];
    disabled?: boolean;
    disabledReason?: string;
}>;

export type AitudouNativeVideoModelCategory = Readonly<{
    id: string;
    label: string;
    options: readonly AitudouNativeVideoModelChoice[];
}>;

export const AITUDOU_NATIVE_OUTPUT_COUNT_PATH = "$tdcanvas.outputCount";
export const AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH = "$tdcanvas.batchCount";
export const AITUDOU_NATIVE_SIZE_RATIO_PATH = "$tdcanvas.image.sizeRatio";

const MIDJOURNEY_BASIC_PARAMETER_FIELDS = new Set(["prompt", "image_urls", "version", "niji", "size", "speed", "hd", "repeat", "metadata"]);
const MIDJOURNEY_V82_RATIOS = ["1:1", "4:3", "3:2", "16:9", "3:4", "2:3", "9:16"] as const;
const MIDJOURNEY_V81_RATIOS = ["1:1", "4:3", "3:2", "16:9", "2:3", "9:16"] as const;
const MIDJOURNEY_CONSERVATIVE_RATIOS = ["1:1", "16:9", "9:16"] as const;

const MIDJOURNEY_MODEL_CHOICES = [
    { label: "Midjourney（默认版本）", value: "midjourney:default" },
    { label: "Midjourney V8.2", value: "midjourney:v8.2" },
    { label: "Midjourney V8.1", value: "midjourney:v8.1" },
    { label: "Midjourney V7", value: "midjourney:v7" },
    { label: "Midjourney V6.1", value: "midjourney:v6.1" },
    { label: "Midjourney V5.2", value: "midjourney:v5.2" },
    { label: "Midjourney V5.1", value: "midjourney:v5.1" },
    { label: "Midjourney Niji 7", value: "midjourney:niji7" },
    { label: "Midjourney Niji 6", value: "midjourney:niji6" },
] as const;

const VIDEO_MODEL_CATEGORIES = [
    { id: "seedance", label: "Seedance", groups: ["Seedance 2.0", "Seedance 2.5 Standard"] },
    { id: "minimax", label: "MiniMax", groups: ["Hailuo 2.3", "Hailuo H3", "Minimax H3 OW"] },
    { id: "flux", label: "Flux", groups: ["Flux 3 Video"] },
    { id: "aitudou-video", label: "Aitudou Video", groups: ["Aitudou Video"] },
    { id: "video-processing", label: "视频处理", groups: ["Aitudou Upscaler"] },
] as const;

const HIDDEN_VIDEO_MODEL_PREFIXES = ["happyhorse-", "wan-", "kling-", "vidu-"] as const;

export const EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS: AitudouNativeReferenceCounts = {
    image: 0,
    video: 0,
    audio: 0,
    text: 0,
    task: 0,
};

const SUNO_TEXT_OPERATION_IDS = new Set(["suno.lyrics", "suno.upsample-tags", "suno.bpm", "suno.aligned-lyrics", "suno.create-voice", "suno.persona"]);

const AUTOMATIC_INPUT_FIELDS = new Set(["file", "image_urls", "audio_urls", "audio_url", "audioFilePath", "task_id", "task_ids", "index", "audio_index", "audio_indexes", "custom_id"]);

const FIELD_LABELS: Readonly<Record<string, string>> = {
    version: "模型版本",
    response_format: "返回格式",
    max_tokens: "最大输出长度",
    stream: "流式输出",
    continue_at: "续写起点（秒）",
    start_s: "开始时间（秒）",
    end_s: "结束时间（秒）",
    duration_s: "过渡时长（秒）",
    speed: "速度倍率",
    name: "名称",
    tags: "风格标签",
    direction: "方向",
    batch_size: "生成数量",
};

const INPUT_KIND_LABELS: Readonly<Record<AitudouModelInputKind, string>> = {
    "text-to-video": "文生视频",
    "image-to-video": "图生视频",
    "multi-reference-video": "全能参考",
    "reference-to-video": "多图参考",
    "video-to-video": "视频参考",
    "video-edit": "视频编辑",
    "motion-transfer": "动作迁移",
    "lip-sync": "口型同步",
    "video-upscale": "视频超分",
    "text-to-image": "文生图",
    "image-to-image": "图生图",
    "audio-generation": "音频生成",
    "text-chat": "文本对话",
    transcription: "语音转写",
    music: "音乐创作",
    special: "专项能力",
};

const DEFAULT_OPERATION_BY_KIND: Readonly<Record<AitudouNativeNodeKind, string>> = {
    image: "image.generate",
    video: "video.generate",
    audio: "audio.generate",
    text: "text.chat",
};

export type AitudouNativeSpecialAdapter = "unsupported-official-contract" | "hailuo-multi" | "flux-draft" | "vidu-short-play" | "aitudou-video-images" | "aitudou-video-quality" | "aitudou-video-omni" | "aitudou-image-images";

/**
 * Every model which the official model catalogue marks as `special` or
 * `lip-sync`. Keeping this exhaustive makes a newly documented special model
 * fail the contract test until its native-node adapter is designed.
 */
export const AITUDOU_NATIVE_SPECIAL_MODEL_ADAPTERS: Readonly<Record<string, AitudouNativeSpecialAdapter>> = {
    "kling-elements-advanced": "unsupported-official-contract",
    "kling-lip-sync-identify-face": "unsupported-official-contract",
    "kling-lip-sync-tts": "unsupported-official-contract",
    "kling-lip-sync-video": "unsupported-official-contract",
    "hailuo-h3-multi": "hailuo-multi",
    "hailuo-h3-global-multi": "hailuo-multi",
    "flux-3-video-draft-enhance": "flux-draft",
    "flux-3-video-global-draft-enhance": "flux-draft",
    "vidu-q3-drama-short-play": "vidu-short-play",
    "vidu-q3-ad-short-play": "vidu-short-play",
    "aitudou-video-gk-v15": "aitudou-video-images",
    "aitudou-video-v31-fast": "aitudou-video-images",
    "aitudou-video-v31-quality": "aitudou-video-quality",
    "aitudou-video-g-omni-flash": "aitudou-video-omni",
    "aitudou-image-g-v2-lowprice": "aitudou-image-images",
    "aitudou-image-nb-flash": "aitudou-image-images",
    "aitudou-image-nb-2": "aitudou-image-images",
    "aitudou-image-nb-2-lite": "aitudou-image-images",
    "aitudou-image-nb-pro": "aitudou-image-images",
};

export const AITUDOU_NATIVE_UNSUPPORTED_MODEL_IDS = Object.freeze(
    Object.entries(AITUDOU_NATIVE_SPECIAL_MODEL_ADAPTERS)
        .filter(([, adapter]) => adapter === "unsupported-official-contract")
        .map(([modelId]) => modelId),
);

export const AITUDOU_NATIVE_OPERATION_IDS_BY_KIND: Readonly<Record<AitudouNativeNodeKind, readonly string[]>> = {
    image: AITUDOU_OPERATIONS.filter((operation) => operation.id === "image.generate" || (operation.group === "midjourney" && operation.id !== "midjourney.describe" && operation.id !== "midjourney.video")).map((operation) => operation.id),
    video: AITUDOU_OPERATIONS.filter((operation) => ["video.generate", "video.upscale", "midjourney.video", "suno.generate-mp4"].includes(operation.id)).map((operation) => operation.id),
    audio: AITUDOU_OPERATIONS.filter((operation) => operation.id === "audio.generate" || (operation.group === "suno" && operation.id !== "suno.generate-mp4" && !SUNO_TEXT_OPERATION_IDS.has(operation.id))).map((operation) => operation.id),
    text: AITUDOU_OPERATIONS.filter((operation) => ["text.chat", "audio.transcribe", "midjourney.describe"].includes(operation.id) || SUNO_TEXT_OPERATION_IDS.has(operation.id)).map((operation) => operation.id),
};

const NATIVE_KIND_BY_OPERATION = new Map(Object.entries(AITUDOU_NATIVE_OPERATION_IDS_BY_KIND).flatMap(([kind, operationIds]) => operationIds.map((operationId) => [operationId, kind as AitudouNativeNodeKind] as const)));

export function aitudouNativeNodeKind(type: CanvasNodeTypeId): AitudouNativeNodeKind | null {
    if (type === CanvasNodeType.Image) return "image";
    if (type === CanvasNodeType.Video) return "video";
    if (type === CanvasNodeType.Audio) return "audio";
    if (type === CanvasNodeType.Text) return "text";
    return null;
}

export function aitudouNativeKindForOperation(operationId: string): AitudouNativeNodeKind | null {
    return NATIVE_KIND_BY_OPERATION.get(operationId) || null;
}

export function isAitudouNativeOperation(kind: AitudouNativeNodeKind, operationId?: string): boolean {
    return Boolean(operationId && AITUDOU_NATIVE_OPERATION_IDS_BY_KIND[kind].includes(operationId));
}

export function defaultAitudouNativeOperation(kind: AitudouNativeNodeKind): AitudouOperationDefinition {
    return getAitudouOperation(DEFAULT_OPERATION_BY_KIND[kind]);
}

export function getAitudouNativeOperation(kind: AitudouNativeNodeKind, operationId?: string): AitudouOperationDefinition {
    return isAitudouNativeOperation(kind, operationId) ? getAitudouOperation(operationId) : defaultAitudouNativeOperation(kind);
}

export function aitudouNativeOperationGroups(kind: AitudouNativeNodeKind): AitudouNativeOperationGroup[] {
    const operations = AITUDOU_NATIVE_OPERATION_IDS_BY_KIND[kind].map((operationId) => getAitudouOperation(operationId));
    const groups = new Map<string, AitudouOperationDefinition[]>();
    for (const operation of operations) {
        const label = nativeOperationCategory(kind, operation);
        groups.set(label, [...(groups.get(label) || []), operation]);
    }
    return Array.from(groups, ([label, entries]) => ({
        label,
        options: entries.map((operation) => ({ label: operation.label, value: operation.id, description: operation.description })),
    }));
}

export function aitudouNativeModels(operationId: string): readonly AitudouModelProfile[] {
    const family = nativeOperationModelFamily(operationId);
    if (!family) return [];
    return AITUDOU_MODEL_PROFILES.filter((profile) => {
        if (profile.family !== family) return false;
        if (operationId === "video.generate" && HIDDEN_VIDEO_MODEL_PREFIXES.some((prefix) => profile.id.startsWith(prefix))) return false;
        if (operationId === "video.upscale") return profile.inputKind === "video-upscale";
        if (operationId === "video.generate") return profile.inputKind !== "video-upscale";
        return true;
    });
}

export function defaultAitudouNativeModel(operationId: string): AitudouModelProfile | undefined {
    return aitudouNativeModels(operationId)[0];
}

/**
 * Public model choice shown in the canvas. Transport-only input suffixes such
 * as t2i/i2i and t2v/i2v are selected automatically from connected inputs.
 */
export function aitudouNativeModelKey(profile: AitudouModelProfile): string {
    return profile.id.replace(/-(t2i|i2i|t2v|i2v|r2v|v2v|multi|edit|motion)(?=-|$)/, "");
}

export function aitudouNativeModelLabel(profile: AitudouModelProfile): string {
    const key = aitudouNativeModelKey(profile);
    const words: Readonly<Record<string, string>> = {
        aitudou: "Aitudou",
        seedream: "Seedream",
        dola: "Dola",
        qwen: "Qwen",
        image: "Image",
        seedance: "Seedance",
        happyhorse: "HappyHorse",
        kling: "Kling",
        hailuo: "Hailuo",
        flux: "Flux",
        minimax: "MiniMax",
        vidu: "Vidu",
        video: "Video",
        global: "Global",
        standard: "Standard",
        std: "Standard",
        fast: "Fast",
        mini: "Mini",
        pro: "Pro",
        turbo: "Turbo",
        o3: "O3",
        h3: "H3",
        ow: "OW",
        q3: "Q3",
        gk: "GK",
        omni: "Omni",
        v15: "V1.5",
        v31: "V3.1",
        "4k": "4K",
        quality: "Quality",
        lite: "Lite",
        flash: "Flash",
        lowprice: "Low Price",
        upscaler: "Upscaler",
        kimi: "Kimi",
        whisper: "Whisper",
        doubao: "Doubao",
        suno: "Suno",
    };
    return key
        .split("-")
        .map((word) => words[word] || (/^v\d/i.test(word) ? word.toUpperCase() : word))
        .join(" ");
}

export function aitudouInputKindLabel(inputKind: AitudouModelInputKind): string {
    return INPUT_KIND_LABELS[inputKind];
}

export function aitudouNativeModelGroups(operationId: string) {
    const groups = new Map<string, Map<string, AitudouModelProfile>>();
    for (const profile of aitudouNativeModels(operationId)) {
        const entries = groups.get(profile.group) || new Map<string, AitudouModelProfile>();
        const key = aitudouNativeModelKey(profile);
        if (!entries.has(key)) entries.set(key, profile);
        groups.set(profile.group, entries);
    }
    return Array.from(groups, ([label, entries]) => ({
        label,
        options: Array.from(entries, ([value, profile]) => ({ label: aitudouNativeModelLabel(profile), value })),
    }));
}

export function aitudouNativeModelChoiceGroups(kind: AitudouNativeNodeKind, operationId: string): readonly AitudouNativeModelChoiceGroup[] {
    const baseOperationId = kind === "image" && operationId === "midjourney.imagine" ? "image.generate" : operationId;
    const groups: AitudouNativeModelChoiceGroup[] = aitudouNativeModelGroups(baseOperationId);
    if (kind === "image" && ["image.generate", "midjourney.imagine"].includes(operationId)) groups.push({ label: "Midjourney", options: MIDJOURNEY_MODEL_CHOICES });
    return groups;
}

/**
 * Two-level catalogue used by the native video node. The first level is a
 * stable provider/product family and the second level is the public model
 * version. Transport variants (t2v/i2v/r2v/multi) stay automatic and are
 * deliberately collapsed into one version choice.
 */
export function aitudouNativeVideoModelCategories(operationId: string): readonly AitudouNativeVideoModelCategory[] {
    const profiles = aitudouNativeModels(operationId);
    const knownGroups = new Set<string>(VIDEO_MODEL_CATEGORIES.flatMap((category) => [...category.groups]));
    const categorySeeds: readonly { id: string; label: string; groups: readonly string[] }[] = [
        ...VIDEO_MODEL_CATEGORIES,
        ...Array.from(new Set(profiles.map((profile) => profile.group).filter((group) => !knownGroups.has(group)))).map((group) => ({ id: `other:${group}`, label: group, groups: [group] as readonly string[] })),
    ];

    return categorySeeds.flatMap((category) => {
        const entries = new Map<
            string,
            {
                profile: AitudouModelProfile;
                inputKinds: Set<AitudouModelInputKind>;
                profileIds: string[];
            }
        >();
        for (const profile of profiles) {
            if (!category.groups.includes(profile.group)) continue;
            const value = aitudouNativeModelKey(profile);
            const entry = entries.get(value) || { profile, inputKinds: new Set<AitudouModelInputKind>(), profileIds: [] };
            entry.inputKinds.add(profile.inputKind);
            entry.profileIds.push(profile.id);
            entries.set(value, entry);
        }
        if (!entries.size) return [];
        return [
            {
                id: category.id,
                label: category.label,
                options: Array.from(entries, ([value, entry]) => {
                    const disabled = entry.profileIds.every((profileId) => AITUDOU_NATIVE_UNSUPPORTED_MODEL_IDS.includes(profileId));
                    return {
                        label: aitudouNativeModelLabel(entry.profile),
                        value,
                        group: entry.profile.group,
                        capabilities: Array.from(entry.inputKinds, (inputKind) => aitudouInputKindLabel(inputKind)),
                        ...(disabled ? { disabled: true, disabledReason: "Aitudou 官方尚未公开完整请求参数" } : {}),
                    };
                }),
            },
        ];
    });
}

export function readAitudouNativeModelChoice(kind: AitudouNativeNodeKind, operationId: string, payload: Record<string, unknown>): string | undefined {
    if (kind === "image" && operationId === "midjourney.imagine") {
        const version = typeof payload.version === "string" ? payload.version.toLowerCase().replace(/^v/, "") : "";
        if (payload.niji === true && ["7", "6"].includes(version)) return `midjourney:niji${version}`;
        return version ? `midjourney:v${version}` : "midjourney:default";
    }
    const profile = typeof payload.model === "string" ? getAitudouModelProfile(payload.model) : undefined;
    return profile ? aitudouNativeModelKey(profile) : undefined;
}

export function changeAitudouNativeModelChoice(
    kind: AitudouNativeNodeKind,
    operationId: string,
    payload: Record<string, unknown>,
    choice: string,
    referenceCounts: AitudouNativeReferenceCounts = EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS,
): { operationId: string; payload: Record<string, unknown> } {
    const currentPrompt = readAitudouNativePrompt(operationId, payload);
    const currentOutputCount = requestedOutputCount(payload);
    if (kind === "image" && choice.startsWith("midjourney:")) {
        const nextOperationId = "midjourney.imagine";
        const nextPayload = operationId === nextOperationId ? clonePayload(payload) : createAitudouNativePayload(nextOperationId, undefined, referenceCounts);
        writeAitudouNativePrompt(nextOperationId, nextPayload, currentPrompt);
        const version = choice.slice("midjourney:".length);
        delete nextPayload.version;
        delete nextPayload.niji;
        if (version !== "default") {
            const niji = version.startsWith("niji");
            nextPayload.version = niji ? version.slice(4) : version.replace(/^v/, "");
            if (niji) nextPayload.niji = true;
        }
        const numericVersion = typeof nextPayload.version === "string" ? Number(nextPayload.version) : undefined;
        if (nextPayload.niji === true || (numericVersion !== undefined && numericVersion !== 8.1 && numericVersion !== 8.2)) delete nextPayload.hd;
        if (currentOutputCount > 1) nextPayload.repeat = Math.min(currentOutputCount, 40);
        sanitizeMidjourneyImaginePayload(nextPayload);
        return { operationId: nextOperationId, payload: nextPayload };
    }

    const nextOperationId = kind === "image" && operationId === "midjourney.imagine" ? "image.generate" : operationId;
    const basePayload = nextOperationId === operationId ? payload : createAitudouNativePayload(nextOperationId, undefined, referenceCounts);
    if (kind === "image" && nextOperationId !== operationId && currentOutputCount > 1) basePayload.n = currentOutputCount;
    writeAitudouNativePrompt(nextOperationId, basePayload, currentPrompt);
    return { operationId: nextOperationId, payload: changeAitudouNativeModel(nextOperationId, basePayload, choice, referenceCounts) };
}

export function aitudouNativeInputKinds(operationId: string): readonly AitudouModelInputKind[] {
    return Array.from(new Set(aitudouNativeModels(operationId).map((profile) => profile.inputKind)));
}

export function countAitudouNativeReferences(references: readonly AitudouReference[]): AitudouNativeReferenceCounts {
    return references.reduce<AitudouNativeReferenceCounts>((counts, reference) => ({ ...counts, [reference.kind]: counts[reference.kind] + 1 }), EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS);
}

export function aitudouNativeReferencedInputCounts(payload: Record<string, unknown>): AitudouNativeReferenceCounts {
    const counts = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS };
    const stack: unknown[] = [payload];
    while (stack.length) {
        const value = stack.pop();
        if (typeof value === "string") {
            const match = value.match(/^@(Image|Video|Audio|Text|Task|TaskAudioIndex|TaskIndex|TaskZeroIndex)\s+([1-9]\d*)$/i);
            if (!match) continue;
            const rawKind = match[1]!.toLowerCase();
            const kind = rawKind.startsWith("task") ? "task" : (rawKind as keyof AitudouNativeReferenceCounts);
            counts[kind] = Math.max(counts[kind], Number(match[2]));
        } else if (Array.isArray(value)) stack.push(...value);
        else if (value && typeof value === "object") stack.push(...Object.values(value as Record<string, unknown>));
    }
    return counts;
}

export function aitudouNativeModelCapability(profile?: AitudouModelProfile): AitudouNativeModelCapability | null {
    if (!profile) return null;
    const constraints = profile.constraints;
    const inputLabel = modelInputCapabilityLabel(profile);
    const parameters: string[] = [];
    if (constraints?.seconds?.values?.length) parameters.push(`${constraints.seconds.values.join("/")} 秒`);
    else if (constraints?.seconds?.min !== undefined || constraints?.seconds?.max !== undefined) parameters.push(`${constraints.seconds.min ?? 1}–${constraints.seconds.max ?? "不限"} 秒`);
    if (constraints?.resolutions?.length) parameters.push(constraints.resolutions.join("/"));
    if (constraints?.ratios?.length) parameters.push(`比例 ${constraints.ratios.length} 档`);
    if (constraints?.maxOutputs && constraints.maxOutputs > 1) parameters.push(`最多 ${constraints.maxOutputs} 个结果`);
    return {
        modeLabel: INPUT_KIND_LABELS[profile.inputKind],
        inputLabel,
        parameterLabel: parameters.join(" · ") || "使用模型默认参数",
    };
}

export function parseAitudouNativePayload(value?: string): Record<string, unknown> | null {
    if (!value?.trim()) return null;
    try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

export function createAitudouNativePayload(operationId: string, currentPayload?: Record<string, unknown>, referenceCounts: AitudouNativeReferenceCounts = EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS) {
    const operation = getAitudouOperation(operationId);
    const usesOperationDefaults = currentPayload === undefined;
    const payload = clonePayload(currentPayload || operation.defaultPayload);
    const supportedModels = aitudouNativeModels(operationId);
    if (supportedModels.length) {
        const selectedModel = typeof payload.model === "string" ? getAitudouModelProfile(payload.model) : undefined;
        const currentModel = selectedModel && supportedModels.some((profile) => profile.id === selectedModel.id) ? selectedModel : supportedModels[0]!;
        const variants = supportedModels.filter((profile) => aitudouNativeModelKey(profile) === aitudouNativeModelKey(currentModel));
        const model = selectAitudouNativeModelVariant(variants, currentModel, referenceCounts) || currentModel;
        payload.model = model.id;
        sanitizeModelParameters(payload, model);
        injectConnectedReferences(payload, operationId, model, referenceCounts);
    }
    if (operationId === "midjourney.imagine") sanitizeMidjourneyImaginePayload(payload);
    injectOperationReferences(payload, operationId, referenceCounts);
    if (usesPrompt(operation)) {
        const currentPrompt = readAitudouNativePrompt(operationId, payload);
        if (usesOperationDefaults && currentPrompt === "@Text 1" && referenceCounts.text === 0) writeAitudouNativePrompt(operationId, payload, "");
        else if (isMissing(currentPrompt) && referenceCounts.text > 0) writeAitudouNativePrompt(operationId, payload, "@Text 1");
    }
    return payload;
}

export function changeAitudouNativeModel(operationId: string, payload: Record<string, unknown>, modelId: string, referenceCounts: AitudouNativeReferenceCounts = EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS) {
    const supportedModels = aitudouNativeModels(operationId);
    const exactModel = supportedModels.find((profile) => profile.id === modelId);
    const modelKey = exactModel ? aitudouNativeModelKey(exactModel) : modelId;
    const variants = supportedModels.filter((profile) => aitudouNativeModelKey(profile) === modelKey);
    const model = exactModel || selectAitudouNativeModelVariant(variants, variants[0], referenceCounts);
    if (!model) return createAitudouNativePayload(operationId, payload, referenceCounts);
    const next = clonePayload(payload);
    next.model = model.id;
    sanitizeModelParameters(next, model);
    injectConnectedReferences(next, operationId, model, referenceCounts);
    return next;
}

export function selectAitudouNativeModelVariant(models: readonly AitudouModelProfile[], current: AitudouModelProfile | undefined, counts: AitudouNativeReferenceCounts): AitudouModelProfile | undefined {
    if (!models.length) return undefined;
    const byInput = (inputKind: AitudouModelInputKind) => models.find((profile) => profile.inputKind === inputKind);
    const hasImages = counts.image > 0;
    const hasVideos = counts.video > 0;
    const hasAudios = counts.audio > 0;

    if (hasVideos) return byInput("video-to-video") || byInput("video-edit") || byInput("motion-transfer") || byInput("multi-reference-video") || current || models[0];
    if (hasAudios) return byInput("multi-reference-video") || current || models[0];
    if (hasImages) {
        const imageToImage = byInput("image-to-image");
        if (imageToImage) return imageToImage;
        const imageToVideo = byInput("image-to-video");
        if (imageToVideo && (imageToVideo.constraints?.maxImages === undefined || counts.image <= imageToVideo.constraints.maxImages)) return imageToVideo;
        const referenceToVideo = byInput("reference-to-video");
        if (referenceToVideo && (referenceToVideo.constraints?.maxImages === undefined || counts.image <= referenceToVideo.constraints.maxImages)) return referenceToVideo;
        return byInput("multi-reference-video") || imageToVideo || referenceToVideo || current || models[0];
    }
    return byInput("text-to-image") || byInput("text-to-video") || current || models[0];
}

export function readAitudouNativePrompt(operationId: string, payload: Record<string, unknown>): string {
    if (operationId !== "text.chat") return typeof payload.prompt === "string" ? payload.prompt : "";
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const userMessage = messages.find((message) => message && typeof message === "object" && (message as Record<string, unknown>).role === "user") as Record<string, unknown> | undefined;
    return typeof userMessage?.content === "string" ? userMessage.content : "";
}

export function writeAitudouNativePrompt(operationId: string, payload: Record<string, unknown>, prompt: string): Record<string, unknown> {
    if (operationId !== "text.chat") {
        payload.prompt = prompt;
        return payload;
    }
    const messages = Array.isArray(payload.messages) ? clonePayload(payload.messages) : [];
    const userIndex = messages.findIndex((message) => message && typeof message === "object" && (message as Record<string, unknown>).role === "user");
    if (userIndex >= 0) messages[userIndex] = { ...(messages[userIndex] as Record<string, unknown>), content: prompt };
    else messages.push({ role: "user", content: prompt });
    payload.messages = messages;
    return payload;
}

export function aitudouNativeUsesPrompt(operationId: string): boolean {
    return usesPrompt(getAitudouOperation(operationId));
}

export function aitudouNativeParameterDefinitions(operationId: string, payload: Record<string, unknown>): readonly AitudouNativeParameterDefinition[] {
    const operation = getAitudouOperation(operationId);
    const profile = typeof payload.model === "string" ? getAitudouModelProfile(payload.model) : undefined;
    const constraints = profile?.constraints;
    const parameters: AitudouNativeParameterDefinition[] = [];

    if (isSeedreamProfile(profile)) {
        parameters.push(selectParameter(AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, "比例", AITUDOU_SEEDREAM_ASPECT_RATIOS), selectParameter(AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH, "分辨率", AITUDOU_SEEDREAM_RESOLUTIONS));
    } else {
        const sizeRatios = allowedTopLevelSizeRatios(profile, payload);
        if (sizeRatios.length) parameters.push(selectParameter(AITUDOU_NATIVE_SIZE_RATIO_PATH, "比例", ["adaptive", ...sizeRatios]));
        else if (constraints?.ratios?.length) parameters.push(selectParameter("metadata.ratio", "比例", profile?.family === "image" ? ["adaptive", ...constraints.ratios] : constraints.ratios));
        if (constraints?.resolutions?.length) {
            const resolutions = profile?.id === "aitudou-image-g-v2-lowprice" ? ["adaptive", ...constraints.resolutions] : constraints.resolutions;
            parameters.push(selectParameter("metadata.resolution", "分辨率", resolutions));
        }
    }
    if (constraints?.seconds) {
        const options = constraints.seconds.values?.map((value) => ({ label: `${value}秒`, value: String(value) }));
        parameters.push({
            path: "seconds",
            label: "生成时长",
            control: options?.length ? "select" : "slider",
            options,
            min: constraints.seconds.min,
            max: constraints.seconds.max,
            step: 1,
        });
    }
    if (constraints?.maxOutputs && constraints.maxOutputs > 1) {
        parameters.push({ path: "n", label: "生成数量", control: "number", min: 1, max: constraints.maxOutputs, step: 1 });
    } else if (operationId === "image.generate" && profile?.family === "image") {
        parameters.push({ path: AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, label: "生成数量", control: "number", min: 1, max: 4, step: 1 });
    }
    if (constraints?.formats?.length && operationId === "audio.generate") parameters.push(selectParameter("metadata.format", "音频格式", constraints.formats));
    if (constraints?.sampleRates?.length) parameters.push(selectParameter("metadata.sample_rate", "采样率", constraints.sampleRates));

    if (operationId === "midjourney.imagine") {
        const version = typeof payload.version === "string" ? Number(payload.version.replace(/^v/i, "")) : undefined;
        const niji = payload.niji === true;
        parameters.push(selectParameter(AITUDOU_NATIVE_SIZE_RATIO_PATH, "比例", ["adaptive", ...midjourneyRatioPresets(payload)]), selectParameter("speed", "生成速度", ["relax", "fast", "turbo"]), {
            path: AITUDOU_NATIVE_OUTPUT_COUNT_PATH,
            label: "生成数量",
            control: "number",
            min: 1,
            max: 40,
            step: 1,
        });
        if (!niji && (version === undefined || version === 8.1 || version === 8.2)) parameters.push({ path: "hd", label: "HD 高清", control: "boolean", optional: true });
    }

    if (operationId === "audio.generate") {
        parameters.push(
            { path: "metadata.speech_rate", label: "语速", control: "number", min: -50, max: 100, step: 1 },
            { path: "metadata.loudness_rate", label: "响度", control: "number", min: -50, max: 100, step: 1 },
            { path: "metadata.pitch_rate", label: "音高", control: "number", min: -12, max: 12, step: 1 },
        );
    }
    if (operationId === "audio.transcribe") parameters.push(selectParameter("response_format", "返回格式", ["json", "verbose_json", "srt", "text", "vtt"]));

    const specialAdapter = specialAdapterFor(profile);
    if (specialAdapter === "flux-draft") parameters.push({ path: "metadata.draft_cache", label: "Draft Cache", control: "text" });
    if (profile?.id.startsWith("flux-3-video-") && specialAdapter !== "flux-draft") {
        parameters.push(
            { path: "metadata.draft", label: "生成 Draft Cache", control: "boolean", optional: true },
            { path: "metadata.generate_audio", label: "生成音频", control: "boolean", optional: true },
            { path: "metadata.safety_tolerance", label: "安全容忍度", control: "number", min: 0, max: 4, step: 1, optional: true },
        );
    }
    if (specialAdapter === "hailuo-multi" && !constraints?.ratios?.length) parameters.push({ path: "metadata.ratio", label: "画面比例", control: "text", optional: true });
    if (specialAdapter === "vidu-short-play") parameters.push({ path: "metadata.script_name", label: "剧本名称", control: "text", optional: true });
    if (specialAdapter === "aitudou-video-omni") {
        parameters.push({ path: "metadata.extend_from_task_id", label: "续写任务 ID", control: "text", optional: true });
        if (!constraints?.ratios?.length) parameters.push({ path: "metadata.ratio", label: "画面比例", control: "text", optional: true });
    }
    const knownPaths = new Set(parameters.map((parameter) => parameter.path));
    for (const [field, value] of Object.entries(operation.defaultPayload)) {
        if (operationId === "image.generate" && field === "n") continue;
        if (field === "model" || field === "prompt" || field === "messages" || field === "metadata" || AUTOMATIC_INPUT_FIELDS.has(field) || knownPaths.has(field)) continue;
        const definition = scalarParameter(field, value);
        if (definition) parameters.push(definition);
    }
    return parameters;
}

export function readAitudouNativeParameter(payload: Record<string, unknown>, path: string): unknown {
    if (path === AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH) return inferAitudouSeedreamGeometry(payload).ratio;
    if (path === AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH) return inferAitudouSeedreamGeometry(payload).resolution;
    if (path === AITUDOU_NATIVE_SIZE_RATIO_PATH) return typeof payload.size === "string" && payload.size.trim() ? payload.size : "adaptive";
    if (path === AITUDOU_NATIVE_OUTPUT_COUNT_PATH) {
        const repeat = Number(payload.repeat);
        return Number.isInteger(repeat) && repeat >= 2 ? repeat : 1;
    }
    if (path === AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH) return normalizeCanvasBatchCount(getPath(payload, path));
    if (path === "metadata.ratio") {
        const profile = typeof payload.model === "string" ? getAitudouModelProfile(payload.model) : undefined;
        const ratio = getPath(payload, path);
        if (profile?.family === "image" && isMissing(ratio)) return "adaptive";
    }
    return getPath(payload, path);
}

export function writeAitudouNativeParameter(payload: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
    if (isAitudouSeedreamVirtualPath(path)) return writeAitudouSeedreamGeometryParameter(payload, path, value);
    if (path === AITUDOU_NATIVE_SIZE_RATIO_PATH) {
        const next = clonePayload(payload);
        const ratio = typeof value === "string" ? value.trim() : "";
        if (!ratio || ratio === "adaptive") delete next.size;
        else next.size = ratio;
        return next;
    }
    if (path === AITUDOU_NATIVE_OUTPUT_COUNT_PATH) {
        const next = clonePayload(payload);
        const count = Number(value);
        if (!Number.isInteger(count) || count <= 1) delete next.repeat;
        else next.repeat = count;
        return next;
    }
    if (path === AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH) {
        const next = clonePayload(payload);
        const count = normalizeCanvasBatchCount(value);
        setPath(next, path, count > 1 ? count : undefined);
        pruneTdcConfig(next);
        return next;
    }
    if (path === "metadata.ratio" && value === "adaptive") {
        const next = clonePayload(payload);
        setPath(next, path, undefined);
        return next;
    }
    if (path === "metadata.resolution" && value === "adaptive") {
        const next = clonePayload(payload);
        setPath(next, path, undefined);
        return next;
    }
    const next = clonePayload(payload);
    setPath(next, path, value);
    return next;
}

export function prepareAitudouNativeRun(payload: Record<string, unknown>): { payload: Record<string, unknown>; batchCount: number } {
    const next = clonePayload(payload);
    const batchCount = normalizeCanvasBatchCount(getPath(next, AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH));
    delete next.$tdcanvas;
    return { payload: next, batchCount };
}

/**
 * RHTV-style ratio selection for models whose request contract still expects
 * explicit dimensions. The caller keeps a single ratio/resolution UI while
 * this adapter derives Seedream's documented width/height fields.
 */
export function writeAitudouNativeAspectRatio(payload: Record<string, unknown>, ratio: unknown, resolution: unknown = getPath(payload, "metadata.resolution")): Record<string, unknown> {
    const withResolution = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH, resolution);
    return writeAitudouNativeParameter(withResolution, AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, ratio);
}

function writeAitudouSeedreamGeometryParameter(payload: Record<string, unknown>, path: string, value: unknown) {
    const next = clonePayload(payload);
    const current = inferAitudouSeedreamGeometry(next);
    const ratio = path === AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH ? String(value || "adaptive") : current.ratio;
    const resolution = path === AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH ? String(value || "2k") : current.resolution;
    const dimensions = deriveAitudouSeedreamDimensions(ratio, resolution);

    if (ratio === "adaptive" || !dimensions) {
        setPath(next, "metadata.width", undefined);
        setPath(next, "metadata.height", undefined);
        setPath(next, "metadata.resolution", AITUDOU_SEEDREAM_RESOLUTIONS.includes(resolution as (typeof AITUDOU_SEEDREAM_RESOLUTIONS)[number]) ? resolution : "2k");
    } else {
        setPath(next, "metadata.width", dimensions.width);
        setPath(next, "metadata.height", dimensions.height);
        setPath(next, "metadata.resolution", undefined);
    }
    setPath(next, "metadata.ratio", undefined);
    return next;
}

export function validateAitudouNativePayload(kind: AitudouNativeNodeKind, operationId: string, payload: Record<string, unknown>, referenceCounts?: AitudouNativeReferenceCounts): string | null {
    if (!isAitudouNativeOperation(kind, operationId)) return `操作 ${operationId} 不属于${nativeKindLabel(kind)}节点。`;
    const model = typeof payload.model === "string" ? getAitudouModelProfile(payload.model) : undefined;
    if (specialAdapterFor(model) === "unsupported-official-contract") {
        return `${model?.id} 的官方 Aitudou 文档未公开完整请求字段，原生节点已阻止按猜测参数提交。`;
    }
    if (referenceCounts) {
        const missingReference = findMissingPlaceholder(payload, referenceCounts);
        if (missingReference) return missingReference;
    }
    try {
        const operation = getAitudouOperation(operationId);
        const validationPayload = operation.requestMode === "multipart-transcription" ? { ...payload, file: "__canvas_connected_file__" } : payload;
        validateAitudouPayload(operation, validationPayload);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export function summarizeAitudouNativeParameters(operationId: string, payload: Record<string, unknown>): string {
    const definitions = aitudouNativeParameterDefinitions(operationId, payload);
    const values = definitions
        .map((definition) => readAitudouNativeParameter(payload, definition.path))
        .filter((value) => !isMissing(value))
        .slice(0, 4)
        .map(String);
    return values.length ? values.join(" / ") : "默认参数";
}

function nativeOperationCategory(kind: AitudouNativeNodeKind, operation: AitudouOperationDefinition) {
    if (operation.id === `${kind}.generate` || operation.id === "text.chat") return "官方模型";
    if (operation.id === "video.upscale") return "视频处理";
    if (operation.group === "midjourney") return "Midjourney";
    if (operation.group === "suno" && kind === "audio") return operation.id === "suno.generate" || operation.id === "suno.inspo" ? "Suno 创作" : "Suno 音频处理";
    if (operation.group === "suno") return "Suno 派生能力";
    if (operation.id === "audio.transcribe") return "语音理解";
    return "扩展能力";
}

function nativeKindLabel(kind: AitudouNativeNodeKind) {
    return { image: "图片", video: "视频", audio: "音频", text: "文本" }[kind];
}

function modelInputCapabilityLabel(profile: AitudouModelProfile) {
    const constraints = profile.constraints;
    const imageLimit = constraints?.maxImages;
    const videoLimit = constraints?.maxVideos;
    const audioLimit = constraints?.maxAudios;
    const images = imageLimit === undefined ? "图片参考" : imageLimit === 1 ? "图片 1 张" : `图片最多 ${imageLimit} 张`;
    const videos = videoLimit === undefined ? "视频参考" : videoLimit === 1 ? "视频 1 个" : `视频最多 ${videoLimit} 个`;
    const audios = audioLimit === undefined ? "音频参考" : audioLimit === 1 ? "音频 1 个" : `音频最多 ${audioLimit} 个`;

    if (profile.inputKind === "text-to-video" || profile.inputKind === "text-to-image" || profile.inputKind === "text-chat" || profile.inputKind === "music") return "仅文本输入";
    if (profile.inputKind === "image-to-video") return `${images}${imageLimit === 1 ? "（首帧）" : ""}`;
    if (profile.inputKind === "reference-to-video" || profile.inputKind === "image-to-image") return images;
    if (profile.inputKind === "multi-reference-video") return [images, videos, audios].join(" · ");
    if (profile.inputKind === "video-to-video" || profile.inputKind === "video-edit" || profile.inputKind === "motion-transfer" || profile.inputKind === "video-upscale") return videoLimit === undefined ? "视频 1 个" : videos;
    if (profile.inputKind === "audio-generation") return `${images}或${audios}（互斥）`;
    if (profile.inputKind === "transcription") return "音频 1 个";
    return [imageLimit !== undefined ? images : "", videoLimit !== undefined ? videos : "", audioLimit !== undefined ? audios : ""].filter(Boolean).join(" · ") || "按模型要求连接素材";
}

function nativeOperationModelFamily(operationId: string) {
    if (operationId === "video.generate" || operationId === "video.upscale") return "video";
    if (operationId === "image.generate") return "image";
    if (operationId === "audio.generate") return "audio";
    if (operationId === "text.chat") return "text";
    if (operationId === "audio.transcribe") return "transcription";
    return null;
}

function usesPrompt(operation: AitudouOperationDefinition) {
    return operation.id === "video.generate" || operation.id === "image.generate" || operation.id === "audio.generate" || operation.id === "text.chat" || operation.requiredFields.includes("prompt") || "prompt" in operation.defaultPayload;
}

function sanitizeMidjourneyImaginePayload(payload: Record<string, unknown>) {
    for (const field of Object.keys(payload)) {
        if (!MIDJOURNEY_BASIC_PARAMETER_FIELDS.has(field)) delete payload[field];
    }

    const size = typeof payload.size === "string" ? payload.size.trim() : "";
    if (!midjourneyRatioPresets(payload).includes(size)) delete payload.size;

    const speed = typeof payload.speed === "string" ? payload.speed.trim().toLowerCase() : "";
    if (["relax", "fast", "turbo"].includes(speed)) payload.speed = speed;
    else delete payload.speed;

    const repeat = Number(payload.repeat);
    if (!Number.isInteger(repeat) || repeat < 2 || repeat > 40) delete payload.repeat;
    if (typeof payload.hd !== "boolean") delete payload.hd;
}

function midjourneyRatioPresets(payload: Record<string, unknown>): readonly string[] {
    if (payload.niji === true) return MIDJOURNEY_CONSERVATIVE_RATIOS;
    const version = typeof payload.version === "string" ? payload.version.trim().toLowerCase().replace(/^v/, "") : "";
    if (version === "8.2") return MIDJOURNEY_V82_RATIOS;
    if (!version || version === "8.1") return MIDJOURNEY_V81_RATIOS;
    return MIDJOURNEY_CONSERVATIVE_RATIOS;
}

function sanitizeModelParameters(payload: Record<string, unknown>, profile: AitudouModelProfile) {
    const constraints = profile.constraints;
    const specialAdapter = specialAdapterFor(profile);
    const previousRatio = getPath(payload, "metadata.ratio");
    const previousResolution = getPath(payload, "metadata.resolution");
    const previousSize = payload.size;
    const previousSeedreamGeometry = inferAitudouSeedreamGeometry(payload);
    const previousOutputCount = requestedOutputCount(payload);

    if (isSeedreamProfile(profile)) {
        setPath(payload, "metadata.ratio", undefined);
        delete payload.size;
        const inferredRatio = previousSeedreamGeometry.custom || previousSeedreamGeometry.ratio === "adaptive" ? undefined : previousSeedreamGeometry.ratio;
        const migratedRatio = findCaseInsensitive(AITUDOU_SEEDREAM_ASPECT_RATIOS, previousSize) || findCaseInsensitive(AITUDOU_SEEDREAM_ASPECT_RATIOS, previousRatio) || inferredRatio || "adaptive";
        const migratedResolution = findCaseInsensitive(AITUDOU_SEEDREAM_RESOLUTIONS, previousResolution) || previousSeedreamGeometry.resolution || "2k";
        const migrated = writeAitudouSeedreamGeometryParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH, migratedResolution);
        Object.assign(payload, migratedRatio === "adaptive" ? migrated : writeAitudouSeedreamGeometryParameter(migrated, AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, migratedRatio));
    } else {
        const dimensionRatio = previousSeedreamGeometry.dimensions && !previousSeedreamGeometry.custom ? previousSeedreamGeometry.ratio : undefined;
        const ratioCandidate = previousSize || dimensionRatio || previousRatio;
        const sizeRatios = allowedTopLevelSizeRatios(profile, payload);
        if (sizeRatios.length) {
            const canonicalSize = findCaseInsensitive(sizeRatios, ratioCandidate);
            if (canonicalSize === undefined) delete payload.size;
            else payload.size = canonicalSize;
            setPath(payload, "metadata.ratio", undefined);
        } else {
            delete payload.size;
            const canonicalRatio = findCaseInsensitive(constraints?.ratios, ratioCandidate);
            if (canonicalRatio !== undefined) setPath(payload, "metadata.ratio", canonicalRatio);
            else if (profile.family !== "image" && constraints?.allowCustomRatio && isPositiveRatio(ratioCandidate)) setPath(payload, "metadata.ratio", String(ratioCandidate).trim());
            else setPath(payload, "metadata.ratio", undefined);
        }

        const resolutionCandidate = previousSeedreamGeometry.dimensions ? previousSeedreamGeometry.resolution : previousResolution;
        const documentedResolution = findCaseInsensitive(constraints?.resolutions, resolutionCandidate);
        const pinnedG2Resolution = profile.id.startsWith("aitudou-image-g2-") ? "1k" : undefined;
        setPath(payload, "metadata.resolution", documentedResolution || pinnedG2Resolution);
        setPath(payload, "metadata.output_format", undefined);
        setPath(payload, "metadata.width", undefined);
        setPath(payload, "metadata.height", undefined);
        if (profile.id.startsWith("aitudou-image-g2-")) {
            delete payload.quality;
            setPath(payload, "metadata.quality", undefined);
        }
    }

    const format = getPath(payload, "metadata.format");
    if (!constraints?.formats?.some((value) => String(value).toLowerCase() === String(format).toLowerCase())) setPath(payload, "metadata.format", undefined);
    const sampleRate = getPath(payload, "metadata.sample_rate");
    if (!constraints?.sampleRates?.map(String).includes(String(sampleRate))) setPath(payload, "metadata.sample_rate", undefined);
    if (profile.family === "image") {
        setPath(payload, "metadata.n", undefined);
        if (constraints?.maxOutputs === undefined) {
            delete payload.n;
            const batchCount = Math.min(previousOutputCount, 4);
            setPath(payload, AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, batchCount > 1 ? batchCount : undefined);
        } else {
            payload.n = Math.min(Math.max(previousOutputCount, 1), constraints.maxOutputs);
            setPath(payload, AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, undefined);
        }
    } else setPath(payload, AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, undefined);
    pruneTdcConfig(payload);
    const seconds = Number(payload.seconds);
    if (constraints?.seconds) {
        const allowed = constraints.seconds.values;
        const outsideAllowedValues = Boolean(allowed?.length && !allowed.includes(seconds));
        const outsideRange = (constraints.seconds.min !== undefined && seconds < constraints.seconds.min) || (constraints.seconds.max !== undefined && seconds > constraints.seconds.max);
        payload.seconds = Number.isInteger(seconds) && !outsideAllowedValues && !outsideRange ? String(seconds) : String(constraints.seconds.defaultValue);
        delete payload.duration;
        setPath(payload, "metadata.duration", undefined);
    } else delete payload.seconds;
    if (specialAdapter !== "flux-draft") setPath(payload, "metadata.draft_cache", undefined);
    if (specialAdapter !== "vidu-short-play") setPath(payload, "metadata.script_name", undefined);
    if (specialAdapter !== "aitudou-video-omni") setPath(payload, "metadata.extend_from_task_id", undefined);
    if (!constraints?.sizeRatios?.length) delete payload.size;
    if (specialAdapter === "aitudou-video-quality") {
        delete payload.image;
        delete payload.images;
        delete payload.type;
    }
    if (specialAdapter === "aitudou-video-omni") {
        delete payload.seconds;
        delete payload.duration;
        setPath(payload, "metadata.duration", undefined);
    }
}

function allowedTopLevelSizeRatios(profile: AitudouModelProfile | undefined, payload: Record<string, unknown>): readonly string[] {
    const ratios = profile?.constraints?.sizeRatios || [];
    if (profile?.id !== "aitudou-image-g-v2-lowprice") return ratios;
    const resolution = String(getPath(payload, "metadata.resolution") || "").toLowerCase();
    if (resolution !== "4k") return ratios;
    const supportedAt4k = new Set(["16:9", "9:16", "21:9", "9:21"]);
    return ratios.filter((ratio) => supportedAt4k.has(ratio));
}

function findCaseInsensitive<T extends string | number>(values: readonly T[] | undefined, value: unknown): T | undefined {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    const normalized = String(value).trim().toLowerCase();
    return values?.find((candidate) => String(candidate).trim().toLowerCase() === normalized);
}

function requestedOutputCount(payload: Record<string, unknown>) {
    for (const candidate of [getPath(payload, AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH), payload.n, payload.repeat]) {
        const count = Number(candidate);
        if (Number.isInteger(count) && count >= 1) return count;
    }
    return 1;
}

function normalizeCanvasBatchCount(value: unknown) {
    const count = Number(value);
    return Number.isInteger(count) && count >= 1 ? Math.min(count, 4) : 1;
}

function pruneTdcConfig(payload: Record<string, unknown>) {
    const config = payload.$tdcanvas;
    if (config && typeof config === "object" && !Array.isArray(config) && !Object.keys(config as Record<string, unknown>).length) delete payload.$tdcanvas;
}

function isPositiveRatio(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    return Boolean(match && Number(match[1]) > 0 && Number(match[2]) > 0);
}

function isSeedreamProfile(profile?: AitudouModelProfile): boolean {
    return Boolean(profile?.id.includes("seedream"));
}

function injectConnectedReferences(payload: Record<string, unknown>, operationId: string, profile: AitudouModelProfile, counts: AitudouNativeReferenceCounts) {
    removeGeneratedReferences(payload);
    const images = placeholders("Image", counts.image, profile.constraints?.maxImages);
    const videos = placeholders("Video", counts.video, profile.constraints?.maxVideos);
    const audios = placeholders("Audio", counts.audio, profile.constraints?.maxAudios);
    const specialAdapter = specialAdapterFor(profile);

    if (specialAdapter === "hailuo-multi") {
        if (images.length) payload.images = images;
        if (videos.length) payload.video_url = videos;
        if (audios.length) payload.audio_url = audios;
    } else if (specialAdapter === "aitudou-video-omni") {
        if (images.length) payload.images = images;
        const explicitExtendTaskId = getPath(payload, "metadata.extend_from_task_id");
        if (videos.length && isMissing(explicitExtendTaskId)) setPath(payload, "metadata.video_url", videos[0]);
        else if (!videos.length && isMissing(explicitExtendTaskId) && counts.task > 0) setPath(payload, "metadata.extend_from_task_id", "@Task 1");
    } else if (specialAdapter === "aitudou-video-images" || specialAdapter === "aitudou-image-images") {
        if (images.length) payload.images = images;
    } else if (profile.inputKind === "image-to-image" || profile.inputKind === "image-to-video" || profile.inputKind === "reference-to-video") {
        if (images.length) payload.images = images;
    } else if (profile.inputKind === "multi-reference-video") {
        const content = [...images.map((url) => ({ type: "image_url", image_url: { url } })), ...videos.map((url) => ({ type: "video_url", video_url: { url } })), ...audios.map((url) => ({ type: "audio_url", audio_url: { url } }))];
        if (content.length) setPath(payload, "metadata.content", content);
    } else if (profile.inputKind === "video-to-video" && videos.length) setPath(payload, "metadata.video_url", videos[0]);
    else if ((profile.inputKind === "video-edit" || profile.inputKind === "motion-transfer") && videos.length) payload.video_url = videos[0];
    else if (profile.inputKind === "video-upscale" && videos.length) setPath(payload, "metadata.content", [{ type: "video_url", video_url: { url: videos[0] } }]);
    else if (profile.inputKind === "audio-generation") {
        if (images.length) payload.images = images;
        if (audios.length) setPath(payload, "metadata.audio_urls", audios);
    }

    if (operationId === "text.chat" && counts.text > 0 && isMissing(readAitudouNativePrompt(operationId, payload))) writeAitudouNativePrompt(operationId, payload, "@Text 1");
}

function injectOperationReferences(payload: Record<string, unknown>, operationId: string, counts: AitudouNativeReferenceCounts) {
    if (operationId === "midjourney.imagine" && counts.image > 0) payload.image_urls = placeholders("Image", counts.image);
    if (operationId === "midjourney.blend" && counts.image > 0) payload.image_urls = placeholders("Image", counts.image, 4);
    if (operationId === "midjourney.describe" && counts.image > 0) payload.image_urls = placeholders("Image", counts.image, 1);
    if (operationId === "midjourney.video" && counts.task === 0 && counts.image > 0) {
        delete payload.task_id;
        delete payload.index;
        payload.image_urls = placeholders("Image", counts.image, 1);
    }
}

function removeGeneratedReferences(payload: Record<string, unknown>) {
    for (const path of ["images", "image", "video_url", "audio_url", "metadata.content", "metadata.video_url", "metadata.audio_url", "metadata.audio_urls", "metadata.extend_from_task_id"] as const) {
        const value = getPath(payload, path);
        if (containsOnlyCanvasPlaceholders(value)) setPath(payload, path, undefined);
    }
}

function specialAdapterFor(profile?: AitudouModelProfile): AitudouNativeSpecialAdapter | undefined {
    return profile ? AITUDOU_NATIVE_SPECIAL_MODEL_ADAPTERS[profile.id] : undefined;
}

function containsOnlyCanvasPlaceholders(value: unknown): boolean {
    if (typeof value === "string") return /^@(Image|Video|Audio|Task) [1-9]\d*$/.test(value);
    if (Array.isArray(value)) return Boolean(value.length) && value.every(containsOnlyCanvasPlaceholders);
    if (value && typeof value === "object") {
        const values = Object.values(value as Record<string, unknown>);
        return Boolean(values.length) && values.every((child) => (typeof child === "string" ? containsOnlyCanvasPlaceholders(child) || ["image_url", "video_url", "audio_url"].includes(child) : containsOnlyCanvasPlaceholders(child)));
    }
    return false;
}

function placeholders(kind: "Image" | "Video" | "Audio", count: number, maximum?: number) {
    return Array.from({ length: Math.min(count, maximum ?? count) }, (_, index) => `@${kind} ${index + 1}`);
}

function selectParameter(path: string, label: string, values: readonly (string | number)[]): AitudouNativeParameterDefinition {
    return {
        path,
        label,
        control: "select",
        options: values.map((value) => ({ label: value === "adaptive" ? "自适应" : value === "custom" ? "自定义" : String(value), value })),
        optional: true,
    };
}

function scalarParameter(field: string, value: unknown): AitudouNativeParameterDefinition | null {
    const label = FIELD_LABELS[field] || field;
    if (typeof value === "boolean") return { path: field, label, control: "boolean" };
    if (typeof value === "number") return { path: field, label, control: "number" };
    if (typeof value === "string") return { path: field, label, control: "text" };
    return null;
}

function findMissingPlaceholder(payload: Record<string, unknown>, counts: AitudouNativeReferenceCounts): string | null {
    const stack: unknown[] = [payload];
    while (stack.length) {
        const value = stack.pop();
        if (typeof value === "string") {
            const match = value.match(/^@(Image|Video|Audio|Text|Task|TaskAudioIndex|TaskIndex|TaskZeroIndex) ([1-9]\d*)$/);
            if (!match) continue;
            const kind = match[1].startsWith("Task") ? "task" : (match[1].toLowerCase() as keyof AitudouNativeReferenceCounts);
            const index = Number(match[2]);
            if (counts[kind] < index) return `还需要连接第 ${index} 个${{ image: "图片", video: "视频", audio: "音频", text: "文本", task: "任务结果" }[kind]}节点。`;
        } else if (Array.isArray(value)) stack.push(...value.slice().reverse());
        else if (value && typeof value === "object") stack.push(...Object.values(value as Record<string, unknown>));
    }
    return null;
}

function clonePayload<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function getPath(value: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined), value);
}

function setPath(value: Record<string, unknown>, path: string, next: unknown) {
    const parts = path.split(".");
    const last = parts.pop()!;
    let target = value;
    for (const part of parts) {
        const current = target[part];
        if (!current || typeof current !== "object" || Array.isArray(current)) target[part] = {};
        target = target[part] as Record<string, unknown>;
    }
    if (next === undefined || next === null || next === "") delete target[last];
    else target[last] = next;
}

function isMissing(value: unknown) {
    return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
}
