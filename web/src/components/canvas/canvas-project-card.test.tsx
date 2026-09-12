import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

import { CanvasProjectPreview } from "./canvas-project-preview";

const baseProject: CanvasProject = {
    id: "project-1",
    title: "测试画布",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
};

describe("canvas project preview", () => {
    it("renders a stable empty-canvas preview without loading persisted media", () => {
        const html = renderToStaticMarkup(<CanvasProjectPreview project={baseProject} />);
        expect(html).toContain('data-canvas-project-preview="empty"');
        expect(html).not.toContain("<img");
    });

    it("renders project nodes and valid connections as a lightweight vector preview", () => {
        const project: CanvasProject = {
            ...baseProject,
            nodes: [
                { id: "text", type: CanvasNodeType.Text, title: "提示词", position: { x: 0, y: 0 }, width: 240, height: 120 },
                { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 420, y: 80 }, width: 320, height: 240 },
            ],
            connections: [{ id: "connection", fromNodeId: "text", toNodeId: "image" }],
        };
        const html = renderToStaticMarkup(<CanvasProjectPreview project={project} />);

        expect(html).toContain('data-canvas-project-preview="nodes"');
        expect(html).toContain('data-preview-node-type="text"');
        expect(html).toContain('data-preview-node-type="image"');
        expect(html).toContain("<path");
        expect(html).not.toContain("<img");
    });
});
