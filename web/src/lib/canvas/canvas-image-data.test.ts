import { beforeEach, describe, expect, it, vi } from "vitest";

import { cropDataUrl, splitDataUrl } from "./canvas-image-data";

const drawImage = vi.fn();
let canvasIndex = 0;

class TestImage {
    width = 800;
    height = 600;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;

    set src(_value: string) {
        queueMicrotask(() => this.onload?.());
    }
}

describe("canvas image crop and split", () => {
    beforeEach(() => {
        canvasIndex = 0;
        drawImage.mockClear();
        vi.stubGlobal("Image", TestImage);
        vi.stubGlobal("document", {
            createElement: vi.fn((tag: string) => {
                if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
                const id = ++canvasIndex;
                return {
                    width: 0,
                    height: 0,
                    getContext: () => ({ drawImage }),
                    toDataURL: () => `data:image/png;base64,canvas-${id}`,
                };
            }),
        });
    });

    it("crops the requested normalized rectangle at source pixel precision", async () => {
        const result = await cropDataUrl("blob:resolved-source", { x: 0.25, y: 0.1, width: 0.5, height: 0.4 });

        expect(result).toBe("data:image/png;base64,canvas-1");
        expect(drawImage).toHaveBeenCalledTimes(1);
        expect(drawImage.mock.calls[0].slice(1)).toEqual([200, 60, 400, 240, 0, 0, 400, 240]);
    });

    it("honors non-uniform split lines and exports every piece", async () => {
        const pieces = await splitDataUrl("blob:resolved-source", {
            rows: 2,
            columns: 3,
            horizontalLines: [0.25],
            verticalLines: [0.2, 0.7],
        });

        expect(pieces.map(({ row, column }) => [row, column])).toEqual([
            [0, 0],
            [0, 1],
            [0, 2],
            [1, 0],
            [1, 1],
            [1, 2],
        ]);
        expect(drawImage.mock.calls.map((call) => call.slice(1, 5))).toEqual([
            [0, 0, 160, 150],
            [160, 0, 400, 150],
            [560, 0, 240, 150],
            [0, 150, 160, 450],
            [160, 150, 400, 450],
            [560, 150, 240, 450],
        ]);
        expect(pieces.every((piece) => piece.dataUrl.startsWith("data:image/png"))).toBe(true);
    });
});
