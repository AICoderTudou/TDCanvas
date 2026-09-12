export type AitudouModelFamily = "image" | "video" | "audio" | "text" | "transcription" | "music";

export type AitudouModelInputKind =
    | "text-to-video"
    | "image-to-video"
    | "multi-reference-video"
    | "reference-to-video"
    | "video-to-video"
    | "video-edit"
    | "motion-transfer"
    | "lip-sync"
    | "video-upscale"
    | "text-to-image"
    | "image-to-image"
    | "audio-generation"
    | "text-chat"
    | "transcription"
    | "music"
    | "special";

export type AitudouModelConstraints = {
    seconds?: Readonly<{ min?: number; max?: number; values?: readonly number[]; defaultValue: number }>;
    resolutions?: readonly string[];
    ratios?: readonly string[];
    /** Preset-only values written to the top-level image `size` field. */
    sizeRatios?: readonly string[];
    allowCustomRatio?: boolean;
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
    maxReferences?: number;
    maxOutputs?: number;
    minPromptLength?: number;
    maxPromptLength?: number;
    formats?: readonly string[];
    sampleRates?: readonly string[];
    notes?: readonly string[];
};

export type AitudouModelProfile = {
    id: string;
    family: AitudouModelFamily;
    inputKind: AitudouModelInputKind;
    label: string;
    group: string;
    constraints?: AitudouModelConstraints;
};

export type AitudouModelOption = {
    label: string;
    value: string;
    group: string;
    inputKind: AitudouModelInputKind;
};

type ModelSeed = readonly [id: string, inputKind: AitudouModelInputKind, constraints?: AitudouModelConstraints];

const defineModels = (family: AitudouModelFamily, group: string, seeds: readonly ModelSeed[]): AitudouModelProfile[] =>
    seeds.map(([id, inputKind, constraints]) => ({
        id,
        family,
        inputKind,
        label: id,
        group,
        ...(constraints ? { constraints } : {}),
    }));

const SEEDANCE_RATIOS = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const;
const SEEDANCE_STANDARD_RESOLUTIONS = ["480p", "720p", "1080p", "2k", "4k", "native1080p", "native4k"] as const;
const SEEDANCE_FAST_MINI_RESOLUTIONS = ["480p", "720p", "1080p", "2k", "4k"] as const;
const SEEDANCE_25_RESOLUTIONS = ["480p", "720p", "1080p", "2k", "4k"] as const;
const FLUX_RATIOS = ["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const MINIMAX_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] as const;
export const TD_CANVAS_COMMON_IMAGE_RATIOS = ["1:1", "2:3", "3:2", "4:5", "5:4", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "2:1", "1:2", "3:1", "1:3"] as const;
const AITUDOU_IMAGE_G2_RATIOS = ["16:9", "9:16", "1:1"] as const;
const AITUDOU_IMAGE_G2_NOTE = "Aitudou 官方接口仅开放 1k，未提供图像质量、2k 或 4k 参数。";
const QWEN_IMAGE_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"] as const;

const seedance20 = (tier: "standard" | "fast" | "mini", inputKind: AitudouModelInputKind): AitudouModelConstraints => ({
    seconds: { min: 4, max: 15, defaultValue: 5 },
    resolutions: tier === "standard" ? SEEDANCE_STANDARD_RESOLUTIONS : SEEDANCE_FAST_MINI_RESOLUTIONS,
    ratios: SEEDANCE_RATIOS,
    ...(inputKind === "image-to-video" ? { maxImages: 2 } : {}),
    ...(inputKind === "multi-reference-video" ? { maxImages: 9, maxVideos: 3, maxAudios: 3 } : {}),
});

const seedance25 = (inputKind: AitudouModelInputKind): AitudouModelConstraints => ({
    seconds: { min: 4, max: 30, defaultValue: 5 },
    resolutions: SEEDANCE_25_RESOLUTIONS,
    ...(inputKind === "multi-reference-video" ? { maxImages: 30, maxVideos: 10, maxAudios: 10, maxReferences: 50 } : {}),
    notes: ["TDCanvas requires an explicit duration for standard generation; automatic duration is not exposed."],
});

const flux3 = (inputKind: AitudouModelInputKind): AitudouModelConstraints => ({
    seconds: { min: 5, max: 20, defaultValue: 5 },
    resolutions: ["hd", "fhd"],
    ratios: FLUX_RATIOS,
    ...(inputKind === "image-to-video" ? { maxImages: 10 } : {}),
    ...(inputKind === "video-to-video" ? { maxVideos: 1 } : {}),
});

export const AITUDOU_MODEL_PROFILES: readonly AitudouModelProfile[] = [
    ...defineModels("video", "Seedance 2.0", [
        ["seedance-2.0-standard-t2v", "text-to-video", seedance20("standard", "text-to-video")],
        ["seedance-2.0-standard-i2v", "image-to-video", seedance20("standard", "image-to-video")],
        ["seedance-2.0-standard-multi", "multi-reference-video", seedance20("standard", "multi-reference-video")],
        ["seedance-2.0-fast-t2v", "text-to-video", seedance20("fast", "text-to-video")],
        ["seedance-2.0-fast-i2v", "image-to-video", seedance20("fast", "image-to-video")],
        ["seedance-2.0-fast-multi", "multi-reference-video", seedance20("fast", "multi-reference-video")],
        ["seedance-2.0-mini-t2v", "text-to-video", seedance20("mini", "text-to-video")],
        ["seedance-2.0-mini-i2v", "image-to-video", seedance20("mini", "image-to-video")],
        ["seedance-2.0-mini-multi", "multi-reference-video", seedance20("mini", "multi-reference-video")],
        ["seedance-2.0-global-standard-t2v", "text-to-video", seedance20("standard", "text-to-video")],
        ["seedance-2.0-global-standard-i2v", "image-to-video", seedance20("standard", "image-to-video")],
        ["seedance-2.0-global-standard-multi", "multi-reference-video", seedance20("standard", "multi-reference-video")],
        ["seedance-2.0-global-fast-t2v", "text-to-video", seedance20("fast", "text-to-video")],
        ["seedance-2.0-global-fast-i2v", "image-to-video", seedance20("fast", "image-to-video")],
        ["seedance-2.0-global-fast-multi", "multi-reference-video", seedance20("fast", "multi-reference-video")],
        ["seedance-2.0-global-mini-t2v", "text-to-video", seedance20("mini", "text-to-video")],
        ["seedance-2.0-global-mini-i2v", "image-to-video", seedance20("mini", "image-to-video")],
        ["seedance-2.0-global-mini-multi", "multi-reference-video", seedance20("mini", "multi-reference-video")],
    ]),
    ...defineModels("video", "Seedance 2.5 Standard", [
        ["seedance-2.5-standard-t2v", "text-to-video", seedance25("text-to-video")],
        ["seedance-2.5-standard-i2v", "image-to-video", seedance25("image-to-video")],
        ["seedance-2.5-standard-multi", "multi-reference-video", seedance25("multi-reference-video")],
        ["seedance-2.5-global-standard-t2v", "text-to-video", seedance25("text-to-video")],
        ["seedance-2.5-global-standard-i2v", "image-to-video", seedance25("image-to-video")],
        ["seedance-2.5-global-standard-multi", "multi-reference-video", seedance25("multi-reference-video")],
    ]),
    ...defineModels("image", "Seedream", [
        ["seedream-v5-pro-t2i", "text-to-image", { resolutions: ["1k", "2k"], minPromptLength: 5, maxPromptLength: 2000 }],
        ["seedream-v5-pro-i2i", "image-to-image", { resolutions: ["1k", "2k"], maxImages: 10, minPromptLength: 5, maxPromptLength: 2000 }],
    ]),
    ...defineModels("image", "Dola Seedream", [
        ["dola-seedream-5.0-pro-t2i", "text-to-image", { resolutions: ["1k", "2k"], minPromptLength: 5, maxPromptLength: 2000 }],
        ["dola-seedream-5.0-pro-i2i", "image-to-image", { resolutions: ["1k", "2k"], maxImages: 10, minPromptLength: 5, maxPromptLength: 2000 }],
    ]),
    ...defineModels("image", "Aitudou Image G-2", [
        ["aitudou-image-g2-t2i", "text-to-image", { resolutions: ["1k"], ratios: AITUDOU_IMAGE_G2_RATIOS, maxPromptLength: 20000, notes: [AITUDOU_IMAGE_G2_NOTE] }],
        ["aitudou-image-g2-i2i", "image-to-image", { resolutions: ["1k"], ratios: AITUDOU_IMAGE_G2_RATIOS, maxImages: 10, maxPromptLength: 20000, notes: [AITUDOU_IMAGE_G2_NOTE] }],
    ]),
    ...defineModels("image", "Qwen Image 3.0", [
        ["qwen-image-3.0-t2i", "text-to-image", { resolutions: ["1k", "2k"], ratios: QWEN_IMAGE_RATIOS, maxOutputs: 6, maxPromptLength: 3000 }],
        ["qwen-image-3.0-i2i", "image-to-image", { resolutions: ["1k", "2k"], ratios: QWEN_IMAGE_RATIOS, maxImages: 3, maxOutputs: 6, maxPromptLength: 3000 }],
        ["qwen-image-3.0-pro-t2i", "text-to-image", { resolutions: ["1k", "2k"], ratios: QWEN_IMAGE_RATIOS, maxOutputs: 6, maxPromptLength: 3000 }],
        ["qwen-image-3.0-pro-i2i", "image-to-image", { resolutions: ["1k", "2k"], ratios: QWEN_IMAGE_RATIOS, maxImages: 3, maxOutputs: 6, maxPromptLength: 3000 }],
        ["qwen-image-3.0-global-t2i", "text-to-image", { resolutions: ["1k", "2k"], ratios: QWEN_IMAGE_RATIOS, maxOutputs: 6, maxPromptLength: 3000 }],
        ["qwen-image-3.0-global-i2i", "image-to-image", { resolutions: ["1k", "2k"], ratios: QWEN_IMAGE_RATIOS, maxImages: 3, maxOutputs: 6, maxPromptLength: 3000 }],
        ["qwen-image-3.0-global-pro-t2i", "text-to-image", { resolutions: ["1k", "2k"], ratios: QWEN_IMAGE_RATIOS, maxOutputs: 6, maxPromptLength: 3000 }],
        ["qwen-image-3.0-global-pro-i2i", "image-to-image", { resolutions: ["1k", "2k"], ratios: QWEN_IMAGE_RATIOS, maxImages: 3, maxOutputs: 6, maxPromptLength: 3000 }],
    ]),
    ...defineModels("video", "Wan 2.7 Spicy", [["wan-2.7-spicy-i2v", "image-to-video", { seconds: { min: 2, max: 15, defaultValue: 2 }, resolutions: ["720p", "1080p"] }]]),
    ...defineModels("video", "Aitudou Upscaler", [["aitudou-upscaler", "video-upscale", { resolutions: ["720p", "1080p", "2k", "4k"], maxVideos: 1 }]]),
    ...defineModels("video", "HappyHorse 1.1", [
        ["happyhorse-1.1-t2v", "text-to-video", { seconds: { min: 3, max: 15, defaultValue: 5 }, resolutions: ["720p", "1080p"] }],
        ["happyhorse-1.1-i2v", "image-to-video", { seconds: { min: 3, max: 15, defaultValue: 5 }, resolutions: ["720p", "1080p"] }],
        ["happyhorse-1.1-r2v", "reference-to-video", { seconds: { min: 3, max: 15, defaultValue: 5 }, resolutions: ["720p", "1080p"], maxImages: 9 }],
    ]),
    ...defineModels("video", "Kling", [
        ["kling-v3.0-std-t2v", "text-to-video"],
        ["kling-v3.0-pro-t2v", "text-to-video"],
        ["kling-v3.0-std-i2v", "image-to-video"],
        ["kling-v3.0-pro-i2v", "image-to-video"],
        ["kling-v3-turbo-std-t2v", "text-to-video"],
        ["kling-v3-turbo-pro-t2v", "text-to-video"],
        ["kling-v3-turbo-std-i2v", "image-to-video"],
        ["kling-v3-turbo-pro-i2v", "image-to-video"],
        ["kling-v3-4k-t2v", "text-to-video"],
        ["kling-v3-4k-i2v", "image-to-video"],
        ["kling-o3-std-t2v", "text-to-video"],
        ["kling-o3-pro-t2v", "text-to-video"],
        ["kling-o3-std-i2v", "image-to-video"],
        ["kling-o3-pro-i2v", "image-to-video"],
        ["kling-o3-std-r2v", "reference-to-video"],
        ["kling-o3-pro-r2v", "reference-to-video"],
        ["kling-o3-std-edit", "video-edit"],
        ["kling-o3-pro-edit", "video-edit"],
        ["kling-o3-4k-t2v", "text-to-video"],
        ["kling-o3-4k-i2v", "image-to-video"],
        ["kling-o3-4k-r2v", "reference-to-video"],
        ["kling-v3.0-std-motion", "motion-transfer"],
        ["kling-v3.0-pro-motion", "motion-transfer"],
        ["kling-v3.0-4k-motion", "motion-transfer"],
        ["kling-elements-advanced", "special"],
        ["kling-lip-sync-identify-face", "lip-sync"],
        ["kling-lip-sync-tts", "lip-sync"],
        ["kling-lip-sync-video", "lip-sync"],
    ]),
    ...defineModels("video", "Hailuo 2.3", [
        ["hailuo-2.3-t2v-standard", "text-to-video"],
        ["hailuo-2.3-t2v-pro", "text-to-video"],
        ["hailuo-2.3-i2v-standard", "image-to-video"],
        ["hailuo-2.3-i2v-pro", "image-to-video"],
        ["hailuo-2.3-fast-i2v", "image-to-video"],
        ["hailuo-2.3-fast-pro-i2v", "image-to-video"],
    ]),
    ...defineModels("video", "Hailuo H3", [
        ["hailuo-h3-t2v", "text-to-video", { seconds: { min: 5, max: 15, defaultValue: 5 }, resolutions: ["768P", "2K"], ratios: TD_CANVAS_COMMON_IMAGE_RATIOS, allowCustomRatio: true }],
        ["hailuo-h3-i2v", "image-to-video", { seconds: { min: 5, max: 15, defaultValue: 5 }, resolutions: ["768P", "2K"], maxImages: 2 }],
        ["hailuo-h3-multi", "special", { seconds: { min: 5, max: 15, defaultValue: 5 }, resolutions: ["768P", "2K"], ratios: TD_CANVAS_COMMON_IMAGE_RATIOS, allowCustomRatio: true, maxImages: 9, maxVideos: 3, maxAudios: 3 }],
        ["hailuo-h3-global-t2v", "text-to-video", { seconds: { min: 5, max: 15, defaultValue: 5 }, resolutions: ["768P", "2K"], ratios: TD_CANVAS_COMMON_IMAGE_RATIOS, allowCustomRatio: true }],
        ["hailuo-h3-global-i2v", "image-to-video", { seconds: { min: 5, max: 15, defaultValue: 5 }, resolutions: ["768P", "2K"], maxImages: 2 }],
        ["hailuo-h3-global-multi", "special", { seconds: { min: 5, max: 15, defaultValue: 5 }, resolutions: ["768P", "2K"], ratios: TD_CANVAS_COMMON_IMAGE_RATIOS, allowCustomRatio: true, maxImages: 9, maxVideos: 3, maxAudios: 3 }],
    ]),
    ...defineModels("video", "Flux 3 Video", [
        ["flux-3-video-t2v", "text-to-video", flux3("text-to-video")],
        ["flux-3-video-i2v", "image-to-video", flux3("image-to-video")],
        ["flux-3-video-v2v", "video-to-video", flux3("video-to-video")],
        ["flux-3-video-draft-enhance", "special", flux3("special")],
        ["flux-3-video-global-t2v", "text-to-video", flux3("text-to-video")],
        ["flux-3-video-global-i2v", "image-to-video", flux3("image-to-video")],
        ["flux-3-video-global-v2v", "video-to-video", flux3("video-to-video")],
        ["flux-3-video-global-draft-enhance", "special", flux3("special")],
    ]),
    ...defineModels("video", "Minimax H3 OW", [
        ["minimax-h3-ow-t2v", "text-to-video", { seconds: { values: [5, 10, 15], defaultValue: 5 }, resolutions: ["480p", "720p"], ratios: MINIMAX_RATIOS }],
        ["minimax-h3-ow-r2v", "reference-to-video", { seconds: { values: [5, 10, 15], defaultValue: 5 }, resolutions: ["480p", "720p"], ratios: MINIMAX_RATIOS, maxImages: 1 }],
        ["minimax-h3-ow-i2v", "image-to-video", { seconds: { values: [5, 10, 15], defaultValue: 5 }, resolutions: ["480p", "720p"], ratios: MINIMAX_RATIOS, maxImages: 1 }],
    ]),
    ...defineModels("video", "Vidu Q3", [
        ["vidu-q3-pro-t2v", "text-to-video"],
        ["vidu-q3-turbo-t2v", "text-to-video"],
        ["vidu-q3-pro-fast-t2v", "text-to-video"],
        ["vidu-q3-pro-i2v", "image-to-video"],
        ["vidu-q3-turbo-i2v", "image-to-video"],
        ["vidu-q3-pro-fast-i2v", "image-to-video"],
        ["vidu-q3-pro-start-end", "image-to-video", { maxImages: 2 }],
        ["vidu-q3-turbo-start-end", "image-to-video", { maxImages: 2 }],
        ["vidu-q3-pro-fast-start-end", "image-to-video", { maxImages: 2 }],
        ["vidu-q3-r2v", "reference-to-video"],
        ["vidu-q3-mix-r2v", "reference-to-video"],
        ["vidu-q3-ad-r2v", "reference-to-video"],
        ["vidu-q3-drama-r2v", "reference-to-video"],
        ["vidu-q3-drama-short-play", "special"],
        ["vidu-q3-ad-short-play", "special"],
    ]),
    ...defineModels("video", "Aitudou Video", [
        ["aitudou-video-gk-v15", "special", { seconds: { min: 6, max: 30, defaultValue: 6 }, resolutions: ["480p", "720p"], ratios: ["16:9", "9:16", "1:1", "3:2", "2:3"], maxImages: 7 }],
        ["aitudou-video-v31-fast", "special", { seconds: { values: [8], defaultValue: 8 }, resolutions: ["720p", "1080p", "4k"], ratios: ["16:9", "9:16"], maxImages: 3 }],
        ["aitudou-video-v31-quality", "special", { seconds: { values: [8], defaultValue: 8 }, resolutions: ["720p", "1080p", "4k"], ratios: ["16:9", "9:16"], notes: ["Reference mode and three-image reference input are not supported."] }],
        ["aitudou-video-v31-lite", "text-to-video", { seconds: { values: [8], defaultValue: 8 }, resolutions: ["720p", "1080p", "4k"], ratios: ["16:9", "9:16"], maxImages: 0 }],
        [
            "aitudou-video-g-omni-flash",
            "special",
            { resolutions: ["720p"], ratios: TD_CANVAS_COMMON_IMAGE_RATIOS, allowCustomRatio: true, maxImages: 16, maxVideos: 1, notes: ["Duration cannot be specified.", "metadata.video_url and metadata.extend_from_task_id are mutually exclusive."] },
        ],
    ]),
    ...defineModels("image", "Aitudou Image", [
        ["aitudou-image-g-v2-lowprice", "special", { resolutions: ["1k", "2k", "4k"], sizeRatios: TD_CANVAS_COMMON_IMAGE_RATIOS, maxImages: 16, maxOutputs: 10 }],
        ["aitudou-image-gk-v15", "text-to-image", { sizeRatios: ["1:1", "16:9", "9:16", "3:2", "2:3"], maxOutputs: 10 }],
        ["aitudou-image-gk-v15-edit", "image-to-image", { maxImages: 1, maxOutputs: 10 }],
        ["aitudou-image-gk-v2", "text-to-image", { sizeRatios: ["1:1", "16:9", "9:16", "3:2", "2:3"], maxOutputs: 10 }],
        ["aitudou-image-nb-flash", "special", { resolutions: ["1k"], maxImages: 14, maxOutputs: 1, maxPromptLength: 1000 }],
        ["aitudou-image-nb-2", "special", { resolutions: ["0.5k", "1k", "2k", "4k"], maxImages: 14, maxOutputs: 1 }],
        ["aitudou-image-nb-2-lite", "special", { resolutions: ["1k"], maxImages: 14, maxOutputs: 4 }],
        ["aitudou-image-nb-pro", "special", { resolutions: ["1k", "2k", "4k"], maxImages: 14, maxOutputs: 1 }],
    ]),
    ...defineModels("audio", "Doubao Seed Audio 1.0", [
        ["doubao-seed-audio-1.0", "audio-generation", { maxImages: 1, maxAudios: 3, minPromptLength: 5, maxPromptLength: 2048, formats: ["wav", "mp3", "pcm", "ogg_opus"], sampleRates: ["8000", "16000", "24000", "32000", "44100"] }],
    ]),
    ...defineModels("text", "Kimi", [["kimi-k3", "text-chat"]]),
    ...defineModels("transcription", "Whisper", [["whisper-1", "transcription", { formats: ["mp3", "wav", "flac", "m4a", "mp4", "ogg", "opus", "aac", "aiff"] }]]),
    ...defineModels("music", "Suno", [["suno", "music", { notes: ["Version constraints are action-specific and must come from the Suno action registry."] }]]),
];

export const AITUDOU_DOCUMENTED_MEDIA_MODEL_COUNT = 123;
export const AITUDOU_MODEL_COUNT = AITUDOU_MODEL_PROFILES.length;

const MODEL_FAMILIES: readonly AitudouModelFamily[] = ["image", "video", "audio", "text", "transcription", "music"];

const groupedOptions = Object.fromEntries(
    MODEL_FAMILIES.map((family) => [
        family,
        AITUDOU_MODEL_PROFILES.filter((profile) => profile.family === family).map((profile) => ({
            label: profile.label,
            value: profile.id,
            group: profile.group,
            inputKind: profile.inputKind,
        })),
    ]),
) as unknown as Record<AitudouModelFamily, readonly AitudouModelOption[]>;

export const AITUDOU_MODEL_OPTIONS_BY_FAMILY: Readonly<Record<AitudouModelFamily, readonly AitudouModelOption[]>> = groupedOptions;

const MODEL_PROFILE_BY_ID = new Map(AITUDOU_MODEL_PROFILES.map((profile) => [profile.id, profile]));

export const getAitudouModelProfile = (id: string): AitudouModelProfile | undefined => MODEL_PROFILE_BY_ID.get(id);
