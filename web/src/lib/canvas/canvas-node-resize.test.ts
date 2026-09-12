import { describe, expect, it } from "vitest";

import { CANVAS_NODE_RESIZE_LIMITS, clampCanvasNodeResize } from "./canvas-node-size";

describe("clampCanvasNodeResize", () => {
    it("limits freely resized nodes on both axes", () => {
        expect(clampCanvasNodeResize(5000, 3000, false, 1)).toEqual({
            width: CANVAS_NODE_RESIZE_LIMITS.maxWidth,
            height: CANVAS_NODE_RESIZE_LIMITS.maxHeight,
        });
        expect(clampCanvasNodeResize(10, 20, false, 1)).toEqual({
            width: CANVAS_NODE_RESIZE_LIMITS.minWidth,
            height: CANVAS_NODE_RESIZE_LIMITS.minHeight,
        });
    });

    it("keeps media proportions while applying the maximum size", () => {
        expect(clampCanvasNodeResize(5000, 3000, true, 16 / 9)).toEqual({ width: 1600, height: 900 });
        expect(clampCanvasNodeResize(3000, 5000, true, 9 / 16)).toEqual({ width: 675, height: 1200 });
    });

    it("never exceeds the maximum for extreme media proportions", () => {
        const wide = clampCanvasNodeResize(5000, 500, true, 16);
        const tall = clampCanvasNodeResize(500, 5000, true, 1 / 16);
        expect(wide.width).toBeLessThanOrEqual(CANVAS_NODE_RESIZE_LIMITS.maxWidth);
        expect(wide.height).toBeLessThanOrEqual(CANVAS_NODE_RESIZE_LIMITS.maxHeight);
        expect(tall.width).toBeLessThanOrEqual(CANVAS_NODE_RESIZE_LIMITS.maxWidth);
        expect(tall.height).toBeLessThanOrEqual(CANVAS_NODE_RESIZE_LIMITS.maxHeight);
    });
});
