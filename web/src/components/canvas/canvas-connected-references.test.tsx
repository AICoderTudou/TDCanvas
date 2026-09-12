import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

import { CanvasConnectedReferences } from "./canvas-connected-references";

vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/use-theme-store", () => ({
    useThemeStore: (selector: (state: { theme: "dark" }) => unknown) => selector({ theme: "dark" }),
}));

describe("CanvasConnectedReferences", () => {
    it("filters the current node fallback and identifies every connected reference by node id and kind", () => {
        const references: CanvasResourceReference[] = [
            reference("current-node", "image", "blob:current-node"),
            reference("image-reference", "image", "blob:image-reference"),
            reference("video-reference", "video", "blob:video-reference"),
            reference("audio-reference", "audio", "blob:audio-reference"),
            { ...reference("text-reference", "text"), text: "Use a wide establishing shot." },
        ];

        const markup = renderToStaticMarkup(<CanvasConnectedReferences references={references} currentNodeId="current-node" />);

        expect(markup).not.toContain('data-reference-node-id="current-node"');
        expect(markup).toMatch(/data-reference-node-id="image-reference"[^>]*data-reference-kind="image"/);
        expect(markup).toMatch(/data-reference-node-id="video-reference"[^>]*data-reference-kind="video"/);
        expect(markup).toMatch(/data-reference-node-id="audio-reference"[^>]*data-reference-kind="audio"/);
        expect(markup).toMatch(/data-reference-node-id="text-reference"[^>]*data-reference-kind="text"/);
        expect(markup).toContain("Use a wide establishing shot.");
    });

    it("renders a precise disconnect action for connected references", () => {
        const markup = renderToStaticMarkup(<CanvasConnectedReferences references={[{ ...reference("image-reference", "image", "blob:image-reference"), connectionId: "edge-image" }]} onDisconnect={() => undefined} />);

        expect(markup).toContain("canvas.references.disconnect");
    });

    it("dims references beyond the model input limit while keeping them reorderable", () => {
        const references = [
            { ...reference("first-image", "image", "blob:first"), connectionId: "edge-first" },
            { ...reference("second-image", "image", "blob:second"), connectionId: "edge-second" },
        ];
        const markup = renderToStaticMarkup(<CanvasConnectedReferences references={references} usedReferenceCounts={{ image: 1, video: 0, audio: 0, text: 0 }} onReorder={() => undefined} />);

        expect(markup).toMatch(/data-reference-node-id="first-image"[^>]*data-reference-used="true"/);
        expect(markup).toMatch(/data-reference-node-id="second-image"[^>]*data-reference-used="false"/);
        expect(markup).toContain("canvas.references.notUsed");
        expect(markup.match(/draggable="true"/g)).toHaveLength(2);
    });
});

function reference(nodeId: string, kind: CanvasResourceReference["kind"], previewUrl?: string): CanvasResourceReference {
    return {
        id: nodeId,
        source: "self",
        nodeId,
        kind,
        label: nodeId,
        title: nodeId,
        previewUrl,
        active: true,
    };
}
