export type AitudouAspectDimensions = Readonly<{
    width: number;
    height: number;
}>;

export type AitudouAspectGeometry = Readonly<{
    ratio: string;
    resolution: string;
    dimensions: AitudouAspectDimensions | null;
    custom: boolean;
}>;

export const AITUDOU_SEEDREAM_ASPECT_RATIOS = ["adaptive", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "2:1", "1:2", "21:9", "3:1", "1:3", "4:1", "1:4", "8:1", "1:8", "16:1", "1:16"] as const;
export const AITUDOU_SEEDREAM_RESOLUTIONS = ["1k", "2k"] as const;
export const AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH = "$tdcanvas.seedream.ratio";
export const AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH = "$tdcanvas.seedream.resolution";

type SeedreamRatio = Exclude<(typeof AITUDOU_SEEDREAM_ASPECT_RATIOS)[number], "adaptive">;
type SeedreamResolution = (typeof AITUDOU_SEEDREAM_RESOLUTIONS)[number];

// Product mapping captured from the authenticated RHTV Seedream v5 Pro model
// configuration. This is deliberately explicit: each model can expose its own
// listResolution table and must not inherit a generic pixel formula.
const SEEDREAM_DIMENSION_TABLE: Readonly<Record<SeedreamRatio, Readonly<Record<SeedreamResolution, AitudouAspectDimensions>>>> = {
    "1:1": { "1k": { width: 1024, height: 1024 }, "2k": { width: 2048, height: 2048 } },
    "4:3": { "1k": { width: 1152, height: 864 }, "2k": { width: 2304, height: 1728 } },
    "3:4": { "1k": { width: 864, height: 1152 }, "2k": { width: 1728, height: 2304 } },
    "3:2": { "1k": { width: 1200, height: 800 }, "2k": { width: 2496, height: 1664 } },
    "2:3": { "1k": { width: 800, height: 1200 }, "2k": { width: 1664, height: 2496 } },
    "16:9": { "1k": { width: 1280, height: 720 }, "2k": { width: 2560, height: 1440 } },
    "9:16": { "1k": { width: 720, height: 1280 }, "2k": { width: 1440, height: 2560 } },
    "2:1": { "1k": { width: 1376, height: 688 }, "2k": { width: 2880, height: 1440 } },
    "1:2": { "1k": { width: 688, height: 1376 }, "2k": { width: 1440, height: 2880 } },
    "21:9": { "1k": { width: 1568, height: 672 }, "2k": { width: 3024, height: 1296 } },
    "3:1": { "1k": { width: 1680, height: 560 }, "2k": { width: 3504, height: 1168 } },
    "1:3": { "1k": { width: 560, height: 1680 }, "2k": { width: 1168, height: 3504 } },
    "4:1": { "1k": { width: 1920, height: 480 }, "2k": { width: 4096, height: 1024 } },
    "1:4": { "1k": { width: 480, height: 1920 }, "2k": { width: 1024, height: 4096 } },
    "8:1": { "1k": { width: 2816, height: 352 }, "2k": { width: 5760, height: 720 } },
    "1:8": { "1k": { width: 352, height: 2816 }, "2k": { width: 720, height: 5760 } },
    "16:1": { "1k": { width: 3840, height: 240 }, "2k": { width: 8192, height: 512 } },
    "1:16": { "1k": { width: 240, height: 3840 }, "2k": { width: 512, height: 8192 } },
};

export function deriveAitudouSeedreamDimensions(ratio: unknown, resolution: unknown): AitudouAspectDimensions | null {
    const normalizedRatio = normalizeSeedreamRatio(ratio);
    const normalizedResolution = normalizeSeedreamResolution(resolution);
    if (!normalizedRatio || !normalizedResolution) return null;
    return SEEDREAM_DIMENSION_TABLE[normalizedRatio][normalizedResolution];
}

export function inferAitudouSeedreamGeometry(payload: Record<string, unknown>): AitudouAspectGeometry {
    const metadata = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? (payload.metadata as Record<string, unknown>) : {};
    const explicitResolution = normalizeSeedreamResolution(metadata.resolution);
    const width = positiveInteger(metadata.width);
    const height = positiveInteger(metadata.height);

    if (explicitResolution) return { ratio: "adaptive", resolution: explicitResolution, dimensions: null, custom: false };
    if (width && height) {
        for (const resolution of AITUDOU_SEEDREAM_RESOLUTIONS) {
            for (const ratio of AITUDOU_SEEDREAM_ASPECT_RATIOS) {
                if (ratio === "adaptive") continue;
                const dimensions = SEEDREAM_DIMENSION_TABLE[ratio][resolution];
                if (dimensions.width === width && dimensions.height === height) return { ratio, resolution, dimensions, custom: false };
            }
        }
        return { ratio: "custom", resolution: inferResolutionFromLongEdge(width, height), dimensions: { width, height }, custom: true };
    }
    return { ratio: "adaptive", resolution: "2k", dimensions: null, custom: false };
}

export function isAitudouSeedreamVirtualPath(path: string) {
    return path === AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH || path === AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH;
}

function normalizeSeedreamRatio(value: unknown): SeedreamRatio | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return AITUDOU_SEEDREAM_ASPECT_RATIOS.some((ratio) => ratio === normalized) && normalized !== "adaptive" ? (normalized as SeedreamRatio) : null;
}

function normalizeSeedreamResolution(value: unknown): SeedreamResolution | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return AITUDOU_SEEDREAM_RESOLUTIONS.some((resolution) => resolution === normalized) ? (normalized as SeedreamResolution) : null;
}

function positiveInteger(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function inferResolutionFromLongEdge(width: number, height: number): SeedreamResolution {
    return Math.max(width, height) <= 1024 ? "1k" : "2k";
}
