import { describe, expect, it } from "vitest";

import { AITUDOU_SEEDREAM_ASPECT_RATIOS, deriveAitudouSeedreamDimensions, inferAitudouSeedreamGeometry } from "./aitudou-aspect-dimensions";

const RHTV_SEEDREAM_DIMENSIONS = [
    ["1:1", [1024, 1024], [2048, 2048]],
    ["4:3", [1152, 864], [2304, 1728]],
    ["3:4", [864, 1152], [1728, 2304]],
    ["3:2", [1200, 800], [2496, 1664]],
    ["2:3", [800, 1200], [1664, 2496]],
    ["16:9", [1280, 720], [2560, 1440]],
    ["9:16", [720, 1280], [1440, 2560]],
    ["2:1", [1376, 688], [2880, 1440]],
    ["1:2", [688, 1376], [1440, 2880]],
    ["21:9", [1568, 672], [3024, 1296]],
    ["3:1", [1680, 560], [3504, 1168]],
    ["1:3", [560, 1680], [1168, 3504]],
    ["4:1", [1920, 480], [4096, 1024]],
    ["1:4", [480, 1920], [1024, 4096]],
    ["8:1", [2816, 352], [5760, 720]],
    ["1:8", [352, 2816], [720, 5760]],
    ["16:1", [3840, 240], [8192, 512]],
    ["1:16", [240, 3840], [512, 8192]],
] as const;

describe("deriveAitudouSeedreamDimensions", () => {
    it.each(RHTV_SEEDREAM_DIMENSIONS)("uses the captured Seedream product table for %s", (ratio, oneK, twoK) => {
        expect(deriveAitudouSeedreamDimensions(ratio, "1k")).toEqual({ width: oneK[0], height: oneK[1] });
        expect(deriveAitudouSeedreamDimensions(ratio, "2k")).toEqual({ width: twoK[0], height: twoK[1] });
    });

    it.each([
        ["adaptive", "1k"],
        ["auto", "2k"],
        ["16:9", "4k"],
        ["16:9", undefined],
        ["4:5", "1k"],
        ["0:9", "1k"],
    ])("does not invent dimensions for ratio=%s resolution=%s", (ratio, resolution) => {
        expect(deriveAitudouSeedreamDimensions(ratio, resolution)).toBeNull();
    });

    it("exposes only ratios present in Seedream's model-specific table plus adaptive", () => {
        expect(AITUDOU_SEEDREAM_ASPECT_RATIOS).toEqual(["adaptive", ...RHTV_SEEDREAM_DIMENSIONS.map(([ratio]) => ratio)]);
    });

    it("round-trips mapped dimensions and distinguishes legacy custom dimensions", () => {
        expect(inferAitudouSeedreamGeometry({ metadata: { width: 2560, height: 1440 } })).toEqual({ ratio: "16:9", resolution: "2k", dimensions: { width: 2560, height: 1440 }, custom: false });
        expect(inferAitudouSeedreamGeometry({ metadata: { width: 1537, height: 1043 } })).toEqual({ ratio: "custom", resolution: "2k", dimensions: { width: 1537, height: 1043 }, custom: true });
    });

    it("defaults to adaptive 2k and lets resolution take precedence over dimensions", () => {
        expect(inferAitudouSeedreamGeometry({ metadata: {} })).toEqual({ ratio: "adaptive", resolution: "2k", dimensions: null, custom: false });
        expect(inferAitudouSeedreamGeometry({ metadata: { resolution: "1k", width: 1280, height: 720 } })).toEqual({ ratio: "adaptive", resolution: "1k", dimensions: null, custom: false });
    });
});
