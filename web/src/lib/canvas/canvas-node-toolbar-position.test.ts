import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { canvasNodeToolbarAnchor } from "./canvas-node-toolbar-position";

function node(type: CanvasNodeType): CanvasNodeData {
    return { id: "node", type, title: "Title", position: { x: 100, y: 200 }, width: 640, height: 420 };
}

describe("canvasNodeToolbarAnchor", () => {
    it("keeps the toolbar above the editable title for native workbench nodes", () => {
        expect(canvasNodeToolbarAnchor(node(CanvasNodeType.Image), { x: 10, y: 20, k: 1 })).toEqual({ left: 430, top: 164 });
    });

    it("scales the title clearance together with the canvas", () => {
        expect(canvasNodeToolbarAnchor(node(CanvasNodeType.Video), { x: 0, y: 0, k: 0.5 }).top).toBe(68);
    });
});
