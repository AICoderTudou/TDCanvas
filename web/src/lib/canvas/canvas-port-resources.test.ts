import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { buildNodeGenerationInputs } from "@/components/canvas/canvas-node-generation";
import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

import { buildNodeMentionReferences } from "./canvas-resource-references";

const pluginId = "port-resource-test";
const macroType = `${pluginId}:macro`;

afterEach(() => unregisterPluginNodes(pluginId));

describe("port-aware canvas resources", () => {
    it("resolves distinct media from different output ports", () => {
        registerNodeDefinitions(
            [
                {
                    type: macroType,
                    title: "Comfy 工作流",
                    icon: null,
                    defaultSize: { width: 420, height: 300 },
                    ports: [
                        { id: "preview", label: "预览图", direction: "output", dataType: "image" },
                        { id: "final", label: "成片", direction: "output", dataType: "video" },
                    ],
                    resource: (node, portId) => {
                        const outputs = node.metadata?.outputs as Record<string, string> | undefined;
                        if (portId === "preview" && outputs?.preview) return { kind: "image", url: outputs.preview, name: "预览图.png", mimeType: "image/png" };
                        if (portId === "final" && outputs?.final) return { kind: "video", url: outputs.final, name: "成片.mp4", mimeType: "video/mp4" };
                        return null;
                    },
                },
            ],
            pluginId,
        );
        const macro = node("macro", macroType, { outputs: { preview: "blob:preview", final: "blob:final" } });
        const imageTarget = node("image-target", "image");
        const videoTarget = node("video-target", "video");
        const connections: CanvasConnection[] = [
            { id: "preview-edge", fromNodeId: macro.id, fromPortId: "preview", toNodeId: imageTarget.id },
            { id: "final-edge", fromNodeId: macro.id, fromPortId: "final", toNodeId: videoTarget.id },
        ];

        expect(buildNodeMentionReferences(imageTarget, [macro, imageTarget, videoTarget], connections)).toMatchObject([{ outputPortId: "preview", kind: "image", previewUrl: "blob:preview" }]);
        expect(buildNodeGenerationInputs(videoTarget.id, [macro, imageTarget, videoTarget], connections)).toMatchObject([{ nodeId: "macro:final", type: "video", video: { url: "blob:final", name: "成片.mp4" } }]);
    });
});

function node(id: string, type: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 240, metadata };
}
