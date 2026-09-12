import { describe, expect, it } from "vitest";

import { fitMediaNodeGeometry, fitNodeSize, nodeSizeFromRatio } from "./canvas-node-size";

describe("fitNodeSize", () => {
    it("fits within both limits without changing the aspect ratio", () => {
        expect(fitNodeSize(2048, 1024, 620, 350)).toEqual({ width: 620, height: 310 });
    });
});

describe("fitMediaNodeGeometry", () => {
    it("fits a generated image to the default boundary and preserves its center", () => {
        const geometry = fitMediaNodeGeometry(node(), 2048, 1024, 620, 350);

        expect(geometry).toEqual({
            width: 620,
            height: 310,
            position: { x: 100, y: 70 },
        });
    });

    it("fits portrait media without stretching and preserves its center", () => {
        const geometry = fitMediaNodeGeometry(node({ position: { x: 100, y: 200 }, width: 660, height: 371 }), 1080, 1920, 660, 371);

        expect(geometry.width).toBeCloseTo(208.6875);
        expect(geometry.height).toBe(371);
        expect(geometry.position.x).toBeCloseTo(325.65625);
        expect(geometry.position.y).toBe(200);
    });

    it("keeps manually free-resized geometry unchanged", () => {
        const original = node({ metadata: { freeResize: true } });

        expect(fitMediaNodeGeometry(original, 1024, 1024, 620, 350)).toEqual({
            position: original.position,
            width: original.width,
            height: original.height,
        });
    });

    it.each([
        [undefined, 1024],
        [1024, undefined],
        [0, 1024],
        [1024, Number.NaN],
    ])("keeps existing geometry for invalid natural dimensions (%s x %s)", (width, height) => {
        const original = node();

        expect(fitMediaNodeGeometry(original, width, height, 620, 350)).toEqual({
            position: original.position,
            width: original.width,
            height: original.height,
        });
    });
});

describe("nodeSizeFromRatio", () => {
    it("fits a parsed ratio within the supplied base size", () => {
        expect(nodeSizeFromRatio("9:16", 660, 371)).toEqual({ width: 208.6875, height: 371 });
    });
});

function node(overrides: Partial<{ position: { x: number; y: number }; width: number; height: number; metadata: { freeResize?: boolean } }> = {}) {
    return {
        position: { x: 100, y: 50 },
        width: 620,
        height: 350,
        ...overrides,
    };
}
