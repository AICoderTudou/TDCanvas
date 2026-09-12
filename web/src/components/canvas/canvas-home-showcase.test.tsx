import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

import { CanvasHomeShowcase } from "./canvas-home-showcase";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const project: CanvasProject = {
    id: "recent-project",
    title: "最近画布",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T01:00:00.000Z",
    nodes: [{ id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 320, height: 180 }],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
};

describe("canvas home showcase", () => {
    it("uses the latest real project as its visual source", () => {
        const html = renderToStaticMarkup(<CanvasHomeShowcase project={project} />);

        expect(html).toContain('data-canvas-home-showcase="true"');
        expect(html).toContain('data-home-scene-project="recent-project"');
        expect(html).toContain('data-canvas-project-preview="nodes"');
        expect(html).toContain('data-preview-node-type="image"');
    });

    it("keeps a stable empty visual without fetching media", () => {
        const html = renderToStaticMarkup(<CanvasHomeShowcase />);

        expect(html).toContain('data-home-scene-project="empty"');
        expect(html).toContain('data-canvas-project-preview="empty"');
        expect(html).not.toContain("<img");
    });
});
