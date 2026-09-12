import { describe, expect, it } from "vitest";

import { resolveCanvasNodeDrag, type CanvasDragFrame } from "./canvas-alignment-guides";

const moving: CanvasDragFrame[] = [{ id: "moving", x: 100, y: 100, width: 200, height: 120 }];

describe("resolveCanvasNodeDrag", () => {
    it("snaps matching node edges and exposes both guide axes", () => {
        const result = resolveCanvasNodeDrag({
            moving,
            stationary: [{ id: "target", x: 405, y: 342, width: 200, height: 120 }],
            rawDx: 302,
            rawDy: 239,
            scale: 1,
            snapToGrid: false,
        });

        expect(result).toEqual({ dx: 305, dy: 242, guides: { vertical: [405], horizontal: [342] } });
    });

    it("keeps movement fluid when no alignment is within the screen-space threshold", () => {
        const result = resolveCanvasNodeDrag({
            moving,
            stationary: [{ id: "target", x: 800, y: 800, width: 200, height: 120 }],
            rawDx: 111,
            rawDy: 93,
            scale: 1,
            snapToGrid: false,
        });

        expect(result).toEqual({ dx: 111, dy: 93, guides: { vertical: [], horizontal: [] } });
    });

    it("uses grid snapping as a fallback while smart alignment takes priority", () => {
        const gridOnly = resolveCanvasNodeDrag({ moving, stationary: [], rawDx: 21, rawDy: 22, scale: 1, snapToGrid: true });
        const smart = resolveCanvasNodeDrag({
            moving,
            stationary: [{ id: "target", x: 325, y: 326, width: 160, height: 100 }],
            rawDx: 222,
            rawDy: 223,
            scale: 1,
            snapToGrid: true,
        });

        expect(gridOnly).toEqual({ dx: 28, dy: 28, guides: { vertical: [], horizontal: [] } });
        expect(smart).toEqual({ dx: 225, dy: 226, guides: { vertical: [325], horizontal: [326] } });
    });

    it("aligns the outer bounds of a multi-node selection", () => {
        const result = resolveCanvasNodeDrag({
            moving: [
                { id: "a", x: 0, y: 0, width: 100, height: 80 },
                { id: "b", x: 150, y: 20, width: 100, height: 80 },
            ],
            stationary: [{ id: "target", x: 500, y: 300, width: 120, height: 100 }],
            rawDx: 251,
            rawDy: 0,
            scale: 1,
            snapToGrid: false,
        });

        expect(result.dx).toBe(250);
        expect(result.guides.vertical).toEqual([500]);
    });

    it("keeps the magnetic range visually stable across zoom levels", () => {
        const stationary = [{ id: "target", x: 410, y: 500, width: 120, height: 100 }];
        const zoomedOut = resolveCanvasNodeDrag({ moving, stationary, rawDx: 296, rawDy: 0, scale: 0.5, snapToGrid: false });
        const zoomedIn = resolveCanvasNodeDrag({ moving, stationary, rawDx: 296, rawDy: 0, scale: 2, snapToGrid: false });

        expect(zoomedOut.dx).toBe(310);
        expect(zoomedIn.dx).toBe(296);
    });
});
