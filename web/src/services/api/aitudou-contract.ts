export type AitudouOperationGroup = "general" | "midjourney" | "suno";
export type AitudouRequestMode = "none" | "json" | "multipart-upload" | "multipart-transcription";
export type AitudouTaskFamily = "video" | "image" | "audio" | "midjourney" | "music";
export type AitudouOutputKind = "image" | "video" | "audio" | "text" | "file";

export type AitudouOperationDefinition = {
    id: string;
    group: AitudouOperationGroup;
    label: string;
    description: string;
    method: "GET" | "POST";
    path: string;
    requestMode: AitudouRequestMode;
    requiredFields: readonly string[];
    defaultPayload: Record<string, unknown>;
    taskFamily?: AitudouTaskFamily;
    sync?: boolean;
    outputHint: AitudouOutputKind;
    docsAnchor: string;
};

type ActionSnapshot = {
    publicAction: string;
    label: string;
    description: string;
    requiredFields: readonly string[];
    sync?: boolean;
    defaultVersion?: string;
};

const GENERAL_OPERATIONS: AitudouOperationDefinition[] = [
    {
        id: "utility.wallet",
        group: "general",
        label: "查询钱包余额",
        description: "读取当前 API Key 所属账户的钱包余额。",
        method: "GET",
        path: "/api/usage/wallet/",
        requestMode: "none",
        requiredFields: [],
        defaultPayload: {},
        sync: true,
        outputHint: "text",
        docsAnchor: "wallet-balance",
    },
    {
        id: "utility.upload",
        group: "general",
        label: "上传参考素材",
        description: "上传一个已连接的图片、视频或音频，返回 24 小时公网直链。",
        method: "POST",
        path: "/v1/files/upload",
        requestMode: "multipart-upload",
        requiredFields: ["file"],
        defaultPayload: {},
        sync: true,
        outputHint: "text",
        docsAnchor: "upload",
    },
    {
        id: "video.generate",
        group: "general",
        label: "视频生成",
        description: "Seedance、HappyHorse、Wan、Kling、Hailuo、Vidu、FLUX 3 Video 与 Aitudou 视频模型统一入口。",
        method: "POST",
        path: "/v1/videos",
        requestMode: "json",
        requiredFields: ["model"],
        defaultPayload: { model: "", prompt: "@Text 1" },
        taskFamily: "video",
        outputHint: "video",
        docsAnchor: "create-video",
    },
    {
        id: "video.upscale",
        group: "general",
        label: "视频超分",
        description: "Aitudou Upscaler；连接一个视频，选择目标分辨率。",
        method: "POST",
        path: "/v1/videos",
        requestMode: "json",
        requiredFields: ["model", "metadata.content"],
        defaultPayload: { model: "aitudou-upscaler", metadata: { resolution: "1080p", content: [{ type: "video_url", video_url: { url: "@Video 1" } }] } },
        taskFamily: "video",
        outputHint: "video",
        docsAnchor: "upscaler",
    },
    {
        id: "image.generate",
        group: "general",
        label: "图片生成 / 编辑",
        description: "Seedream、Qwen-Image 与 Aitudou 图片模型统一入口。",
        method: "POST",
        path: "/v1/image/generations",
        requestMode: "json",
        requiredFields: ["model", "prompt"],
        defaultPayload: { model: "", prompt: "@Text 1", n: 1, metadata: {} },
        taskFamily: "image",
        outputHint: "image",
        docsAnchor: "create-image",
    },
    {
        id: "audio.generate",
        group: "general",
        label: "Seed Audio 音频生成",
        description: "Doubao Seed Audio 1.0 异步音频生成。",
        method: "POST",
        path: "/v1/audio/generations",
        requestMode: "json",
        requiredFields: ["model", "prompt"],
        defaultPayload: { model: "doubao-seed-audio-1.0", prompt: "@Text 1", metadata: { format: "wav", sample_rate: "24000", speech_rate: 0, loudness_rate: 0, pitch_rate: 0 } },
        taskFamily: "audio",
        outputHint: "audio",
        docsAnchor: "create-audio",
    },
    {
        id: "text.chat",
        group: "general",
        label: "Kimi 文本对话",
        description: "OpenAI Chat Completions 兼容的同步或流式文本对话。",
        method: "POST",
        path: "/v1/chat/completions",
        requestMode: "json",
        requiredFields: ["model", "messages"],
        defaultPayload: { model: "kimi-k3", stream: false, max_tokens: 1024, messages: [{ role: "user", content: "@Text 1" }] },
        sync: true,
        outputHint: "text",
        docsAnchor: "chat-completions",
    },
    {
        id: "audio.transcribe",
        group: "general",
        label: "Whisper 语音转写",
        description: "连接一个音频节点，同步输出 json、verbose_json、srt、text 或 vtt。",
        method: "POST",
        path: "/v1/audio/transcriptions",
        requestMode: "multipart-transcription",
        requiredFields: ["file", "model"],
        defaultPayload: { model: "whisper-1", response_format: "json" },
        sync: true,
        outputHint: "text",
        docsAnchor: "transcribe",
    },
];

// Snapshot of GET /api/midjourney/actions. Public paths use public_action; upstream_suffix is intentionally not used.
const MIDJOURNEY_ACTIONS: readonly ActionSnapshot[] = [
    { publicAction: "imagine", label: "Imagine 文生图", description: "根据提示词生成四宫格图片。", requiredFields: ["prompt"] },
    { publicAction: "blend", label: "Blend 多图融合", description: "融合 2–4 张参考图片。", requiredFields: ["image_urls"] },
    { publicAction: "describe", label: "Describe 图生文", description: "把一张参考图片描述为提示词。", requiredFields: ["image_urls"], sync: true },
    { publicAction: "edits", label: "Edits 图片编辑", description: "根据提示词编辑参考图片。", requiredFields: ["prompt", "image_urls"] },
    { publicAction: "upscale", label: "Upscale 放大选图", description: "放大父任务中的一个宫格。", requiredFields: ["task_id"] },
    { publicAction: "variation", label: "Variation 生成变体", description: "生成父任务宫格的轻微变体。", requiredFields: ["task_id"] },
    { publicAction: "high-variation", label: "High Variation 大幅变体", description: "对已放大图片生成强变体。", requiredFields: ["task_id"] },
    { publicAction: "low-variation", label: "Low Variation 微调变体", description: "对已放大图片生成轻微变体。", requiredFields: ["task_id"] },
    { publicAction: "reroll", label: "Reroll 重新生成", description: "使用相同提示词重新生成四宫格。", requiredFields: ["task_id"] },
    { publicAction: "zoom", label: "Zoom 缩放扩展", description: "缩放并扩展已放大的图片。", requiredFields: ["task_id"] },
    { publicAction: "pan", label: "Pan 平移扩展", description: "向指定方向扩展已放大的图片。", requiredFields: ["task_id"] },
    { publicAction: "inpaint", label: "Inpaint 局部重绘", description: "启动局部重绘会话。", requiredFields: ["task_id"] },
    { publicAction: "modal", label: "Modal 补充重绘参数", description: "为 MODAL 状态任务提交蒙版与提示词。", requiredFields: ["task_id"] },
    { publicAction: "video", label: "Video 图生视频", description: "从 Midjourney 任务或图片生成视频。", requiredFields: [] },
    { publicAction: "remix-strong", label: "Remix Strong 强重塑", description: "对 v8.1 / v8.2 父图做强重塑。", requiredFields: ["task_id", "index"] },
    { publicAction: "remix-subtle", label: "Remix Subtle 弱重塑", description: "对 v8.1 / v8.2 父图做轻微重塑。", requiredFields: ["task_id", "index"] },
];

// Snapshot of GET /api/music/actions. Public paths use kebab-case public_action.
const SUNO_ACTIONS: readonly ActionSnapshot[] = [
    { publicAction: "generate", label: "生成音乐", description: "灵感模式或自定义歌词模式生成音乐。", requiredFields: ["version"], defaultVersion: "v5.5" },
    { publicAction: "lyrics", label: "生成歌词", description: "根据主题生成歌词文本。", requiredFields: ["prompt"], sync: false },
    { publicAction: "upload", label: "上传音频", description: "把公网音频导入为可复用源音轨。", requiredFields: ["audioFilePath"] },
    { publicAction: "extend", label: "续写延长", description: "从指定时间继续现有音轨。", requiredFields: ["task_id", "continue_at"], defaultVersion: "v5.5" },
    { publicAction: "cover-song", label: "风格翻唱", description: "以新风格翻唱已有歌曲。", requiredFields: ["task_id"], defaultVersion: "v5.5" },
    { publicAction: "inspo", label: "灵感生成", description: "根据 1–4 个公网音频参考生成音乐。", requiredFields: ["audio_urls"], defaultVersion: "v5.5" },
    { publicAction: "mashup", label: "生成混搭", description: "混合两个源任务音轨。", requiredFields: ["task_ids"], defaultVersion: "v5.5" },
    { publicAction: "upsample-tags", label: "标签增强", description: "扩展并优化音乐风格标签。", requiredFields: ["tags"], sync: true },
    { publicAction: "sounds", label: "音效生成", description: "根据描述生成单次或循环音效。", requiredFields: ["prompt"], defaultVersion: "v5.5" },
    { publicAction: "create-voice", label: "创建音色", description: "从公网音频创建可复用音色。", requiredFields: ["audio_url"] },
    { publicAction: "stems", label: "分轨提取", description: "从音轨中提取指定 stem。", requiredFields: ["task_id"] },
    { publicAction: "stems-all", label: "全量分轨", description: "执行完整多轨分离。", requiredFields: ["task_id"] },
    { publicAction: "wav", label: "导出 WAV", description: "把指定音轨导出为 WAV。", requiredFields: ["task_id"] },
    { publicAction: "generate-mp4", label: "生成音乐视频", description: "为指定音轨生成 MP4 音乐视频。", requiredFields: ["task_id"] },
    { publicAction: "concat", label: "完整歌曲合成", description: "把片段拼接成完整歌曲。", requiredFields: ["task_id"] },
    { publicAction: "crop", label: "裁剪音频", description: "按时间范围裁剪音轨。", requiredFields: ["task_id", "start_s", "end_s"] },
    { publicAction: "fade-in", label: "淡入", description: "为音轨添加淡入。", requiredFields: ["task_id", "duration_s"] },
    { publicAction: "fade-out", label: "淡出", description: "为音轨添加淡出。", requiredFields: ["task_id", "duration_s"] },
    { publicAction: "remove-section", label: "删除片段", description: "删除指定时间范围。", requiredFields: ["task_id", "start_s", "end_s"] },
    { publicAction: "replace-music", label: "段落替换", description: "替换指定时间范围的音乐。", requiredFields: ["task_id", "start_s", "end_s"], defaultVersion: "v5.5" },
    { publicAction: "adjust-speed", label: "调整速度", description: "不改变音高地调整速度。", requiredFields: ["task_id", "speed"] },
    { publicAction: "remaster", label: "母带优化", description: "优化现有音轨的母带。", requiredFields: ["task_id"], defaultVersion: "v5.5" },
    { publicAction: "midi", label: "生成 MIDI", description: "从音轨生成 MIDI 文件。", requiredFields: ["task_id"] },
    { publicAction: "bpm", label: "BPM 分析", description: "分析音轨 BPM。", requiredFields: ["task_id"] },
    { publicAction: "aligned-lyrics", label: "歌词时间轴", description: "生成逐行对齐的歌词时间轴。", requiredFields: ["task_id"] },
    { publicAction: "persona", label: "Persona", description: "从音轨创建歌手 Persona。", requiredFields: ["task_id", "name"] },
    { publicAction: "vox", label: "提取 Vox", description: "提取人声片段。", requiredFields: ["task_id"] },
    { publicAction: "sample", label: "样本转歌曲", description: "从音轨片段生成歌曲。", requiredFields: ["task_id", "start_s", "end_s"], defaultVersion: "v5.5" },
    { publicAction: "add-vocals", label: "添加人声", description: "在源音轨上叠加人声。", requiredFields: ["task_id"], defaultVersion: "v5.5" },
    { publicAction: "add-instrumental", label: "添加伴奏", description: "在源音轨上叠加伴奏。", requiredFields: ["task_id"], defaultVersion: "v5.5" },
    { publicAction: "add-stem", label: "添加音轨", description: "在现有音轨上叠加 stem。", requiredFields: ["task_id"], defaultVersion: "v5.5" },
];

const fieldPlaceholder = (field: string): unknown => {
    if (field === "image_urls") return ["@Image 1"];
    if (field === "audio_urls") return ["@Audio 1"];
    if (field === "audio_url" || field === "audioFilePath") return "@Audio 1";
    if (field === "task_id") return "@Task 1";
    if (field === "task_ids") return ["@Task 1", "@Task 2"];
    if (field === "index") return "@TaskIndex 1";
    if (field === "continue_at" || field === "start_s") return 0;
    if (field === "end_s") return 10;
    if (field === "duration_s") return 3;
    if (field === "speed") return 1;
    if (field === "version") return "v5.5";
    return "";
};

const payloadFromSnapshot = (action: ActionSnapshot, model?: string) => ({
    ...(model ? { model } : {}),
    ...Object.fromEntries(action.requiredFields.map((field) => [field, field === "version" && action.defaultVersion ? action.defaultVersion : fieldPlaceholder(field)])),
    ...(action.defaultVersion && !action.requiredFields.includes("version") ? { version: action.defaultVersion } : {}),
    ...(model === "suno" && action.requiredFields.includes("task_id") ? { audio_index: "@TaskAudioIndex 1" } : {}),
});

const MIDJOURNEY_OPERATIONS: AitudouOperationDefinition[] = MIDJOURNEY_ACTIONS.map((action) => ({
    id: `midjourney.${action.publicAction}`,
    group: "midjourney",
    label: action.label,
    description: action.description,
    method: "POST",
    path: action.publicAction === "imagine" ? "/v1/midjourney/generations" : `/v1/midjourney/generations/${action.publicAction}`,
    requestMode: "json",
    requiredFields: action.requiredFields,
    defaultPayload: {
        ...payloadFromSnapshot(action),
        ...(["upscale", "variation", "high-variation", "low-variation", "remix-strong", "remix-subtle"].includes(action.publicAction) ? { index: "@TaskIndex 1" } : {}),
        ...(action.publicAction === "pan" ? { direction: "right" } : {}),
        ...(action.publicAction === "video" ? { task_id: "@Task 1", index: "@TaskZeroIndex 1", batch_size: 1 } : {}),
    },
    taskFamily: "midjourney",
    sync: action.sync,
    outputHint: action.publicAction === "describe" ? "text" : action.publicAction === "video" ? "video" : "image",
    docsAnchor: `mj-${action.publicAction === "remix-strong" || action.publicAction === "remix-subtle" ? "remix" : action.publicAction}`,
}));

const SUNO_TEXT_ACTIONS = new Set(["lyrics", "upsample-tags", "bpm", "aligned-lyrics", "create-voice", "persona"]);
const SUNO_OPERATIONS: AitudouOperationDefinition[] = SUNO_ACTIONS.map((action) => ({
    id: `suno.${action.publicAction}`,
    group: "suno",
    label: action.label,
    description: action.description,
    method: "POST",
    path: action.publicAction === "generate" ? "/v1/music/generations" : `/v1/music/generations/${action.publicAction}`,
    requestMode: "json",
    requiredFields: action.requiredFields,
    defaultPayload: {
        ...payloadFromSnapshot(action, "suno"),
        ...(action.publicAction === "generate" ? { prompt: "@Text 1" } : {}),
        ...(action.publicAction === "mashup" ? { audio_indexes: ["@TaskAudioIndex 1", "@TaskAudioIndex 2"] } : {}),
    },
    taskFamily: "music",
    sync: action.sync,
    outputHint: SUNO_TEXT_ACTIONS.has(action.publicAction) ? "text" : action.publicAction === "generate-mp4" ? "video" : action.publicAction === "midi" ? "file" : "audio",
    docsAnchor: `suno-${action.publicAction === "generate" ? "generation" : action.publicAction}`,
}));

export const AITUDOU_OPERATIONS: readonly AitudouOperationDefinition[] = [...GENERAL_OPERATIONS, ...MIDJOURNEY_OPERATIONS, ...SUNO_OPERATIONS];
export type AitudouOperationId = (typeof AITUDOU_OPERATIONS)[number]["id"];

const operationById = new Map(AITUDOU_OPERATIONS.map((operation) => [operation.id, operation]));

export function getAitudouOperation(id?: string) {
    return operationById.get(id || "") || GENERAL_OPERATIONS[2];
}

export function aitudouDefaultPayload(id?: string) {
    return JSON.stringify(getAitudouOperation(id).defaultPayload, null, 2);
}

export function aitudouOperationsByGroup() {
    return [
        { label: "通用能力", options: GENERAL_OPERATIONS.map(toOption) },
        { label: "Midjourney", options: MIDJOURNEY_OPERATIONS.map(toOption) },
        { label: "Suno", options: SUNO_OPERATIONS.map(toOption) },
    ];
}

function toOption(operation: AitudouOperationDefinition) {
    return { label: operation.label, value: operation.id };
}

export const AITUDOU_ACTION_REGISTRY_PATHS = {
    midjourney: "/api/midjourney/actions",
    suno: "/api/music/actions",
} as const;
