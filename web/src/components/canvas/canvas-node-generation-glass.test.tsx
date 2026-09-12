import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
    default: { t: (key: string) => key },
}));

vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { CanvasNode, shouldShowMediaGenerationGlass } from "./canvas-node";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const noop = () => undefined;

describe("media generation glass overlay", () => {
    it("keeps a previous image visible behind the glass overlay while regenerating", () => {
        const node = mediaNode(CanvasNodeType.Image, "https://cdn.example.test/previous.png", "loading");
        const html = renderNode(node);

        expect(shouldShowMediaGenerationGlass(node)).toBe(true);
        expect(html).toContain('src="https://cdn.example.test/previous.png"');
        expect(html).toContain("data-canvas-media-generation-glass");
        expect(html).toContain("canvas.node.generating");
    });

    it("applies the same non-transparent regeneration state to an existing video", () => {
        const node = mediaNode(CanvasNodeType.Video, "https://cdn.example.test/previous.mp4", "loading");
        const html = renderNode(node);

        expect(shouldShowMediaGenerationGlass(node)).toBe(true);
        expect(html).toContain('src="https://cdn.example.test/previous.mp4"');
        expect(html).toContain("data-canvas-media-generation-glass");
    });

    it("keeps empty/loading and completed media out of the glass state", () => {
        const emptyLoading = mediaNode(CanvasNodeType.Image, "", "loading");
        const completed = mediaNode(CanvasNodeType.Image, "https://cdn.example.test/result.png", "success");

        expect(shouldShowMediaGenerationGlass(emptyLoading)).toBe(false);
        expect(renderNode(emptyLoading)).not.toContain("data-canvas-media-generation-glass");
        expect(shouldShowMediaGenerationGlass(completed)).toBe(false);
        expect(renderNode(completed)).not.toContain("data-canvas-media-generation-glass");
    });

    it("keeps history thumbnails off the image until the user opens version history", () => {
        const node = mediaNode(CanvasNodeType.Image, "https://cdn.example.test/latest.png", "success");
        node.metadata = {
            ...node.metadata,
            activeImageHistoryId: "latest",
            imageHistory: [
                { id: "previous", content: "https://cdn.example.test/previous.png", createdAt: "2026-08-23T00:00:00.000Z" },
                { id: "latest", content: "https://cdn.example.test/latest.png", createdAt: "2026-08-23T00:01:00.000Z" },
            ],
        };
        const html = renderNode(node);

        expect(html).toContain("data-canvas-image-history-trigger");
        expect(html).toContain('aria-expanded="false"');
        expect(html).not.toContain("data-canvas-image-history\"");
        expect(html).not.toContain('src="https://cdn.example.test/previous.png"');
        expect(html).toContain('src="https://cdn.example.test/latest.png"');
    });
});

function mediaNode(type: CanvasNodeType.Image | CanvasNodeType.Video, content: string, status: "loading" | "success"): CanvasNodeData {
    return {
        id: `${type}-${status}`,
        type,
        title: type === CanvasNodeType.Image ? "图片" : "视频",
        position: { x: 0, y: 0 },
        width: 620,
        height: 350,
        metadata: { content, status, providerTask: { provider: "aitudou", progress: 42 } },
    };
}

function renderNode(data: CanvasNodeData) {
    return renderToStaticMarkup(
        <CanvasNode
            data={data}
            scale={1}
            isSelected={false}
            isRelated={false}
            isFocusRelated={false}
            isConnectionTarget={false}
            isConnecting={false}
            showPanel={false}
            showImageInfo={false}
            onMouseDown={noop}
            onHoverStart={noop}
            onHoverEnd={noop}
            onConnectStart={noop}
            onResizeStart={noop}
            onResize={noop}
            onResizeEnd={noop}
            onContentChange={noop}
            onTitleChange={noop}
            onContextMenu={noop}
        />,
    );
}
