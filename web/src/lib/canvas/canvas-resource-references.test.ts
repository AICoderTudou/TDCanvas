import { describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

import { buildNodeMentionReferences, reorderCanvasConnections, reorderCanvasObjectReferences } from "./canvas-resource-references";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

describe("buildNodeMentionReferences", () => {
    it("reorders connection-backed references in the order used for generation", () => {
        const connections = [
            { id: "edge-a", fromNodeId: "image-a", toNodeId: "target" },
            { id: "other-edge", fromNodeId: "other-image", toNodeId: "other-target" },
            { id: "edge-b", fromNodeId: "image-b", toNodeId: "target" },
            { id: "edge-c", fromNodeId: "image-c", toNodeId: "target" },
        ];
        expect(reorderCanvasConnections(connections, "edge-a", "edge-c").map((item) => item.id)).toEqual(["edge-b", "other-edge", "edge-c", "edge-a"]);
        expect(connections.map((item) => item.id)).toEqual(["edge-a", "other-edge", "edge-b", "edge-c"]);
        expect(reorderCanvasConnections(connections, "edge-a", "other-edge")).toBe(connections);
    });
    it("maps directly connected image, video, audio, and text nodes and drops them after their connections are removed", () => {
        const target = node("target", CanvasNodeType.Image, "Image generation");
        const image = node("image-reference", CanvasNodeType.Image, "Reference image", { content: "blob:reference-image" });
        const video = node("video-reference", CanvasNodeType.Video, "Reference video", { content: "blob:reference-video" });
        const audio = node("audio-reference", CanvasNodeType.Audio, "Reference audio", { content: "blob:reference-audio" });
        const text = node("text-reference", CanvasNodeType.Text, "Reference text", { content: "Keep the subject centered." });
        const nodes = [image, video, audio, text, target];
        const connections = [connection(image.id, target.id), connection(video.id, target.id), connection(audio.id, target.id), connection(text.id, target.id)];

        expect(buildNodeMentionReferences(target, nodes, connections)).toMatchObject([
            { connectionId: connections[0].id, nodeId: image.id, kind: "image", previewUrl: "blob:reference-image", active: true },
            { connectionId: connections[1].id, nodeId: video.id, kind: "video", previewUrl: "blob:reference-video", active: true },
            { connectionId: connections[2].id, nodeId: audio.id, kind: "audio", previewUrl: "blob:reference-audio", active: true },
            { connectionId: connections[3].id, nodeId: text.id, kind: "text", previewUrl: "Keep the subject centered.", text: "Keep the subject centered.", active: true },
        ]);

        expect(buildNodeMentionReferences(target, nodes, [])).toEqual([]);
    });

    it("reads a generated node result as a canvas-wide object reference without a connection", () => {
        const source = node("generated-image", CanvasNodeType.Image, "Character reference", { content: "asset://generated.png", sourceOrigin: "generated", canvasSetEnabled: true });
        const target = node("target", CanvasNodeType.Video, "Video generation", {
            objectReferences: [{ id: "get-character", sourceNodeId: source.id, versionMode: "latest" }],
        });

        expect(buildNodeMentionReferences(target, [source, target], [])).toMatchObject([
            {
                id: "get-character",
                objectReferenceId: "get-character",
                source: "object",
                nodeId: source.id,
                kind: "image",
                previewUrl: "asset://generated.png",
            },
        ]);
    });

    it("does not expose a node result until the user explicitly Sets it", () => {
        const source = node("private-image", CanvasNodeType.Image, "Private result", { content: "asset://private.png", sourceOrigin: "generated" });
        const target = node("target", CanvasNodeType.Video, "Video generation", {
            objectReferences: [{ id: "stale-get", sourceNodeId: source.id, versionMode: "latest" }],
        });

        expect(buildNodeMentionReferences(target, [source, target], [])).toEqual([]);
    });

    it("reorders object references without mutating the stored list", () => {
        const references = [
            { id: "a", sourceNodeId: "image-a" },
            { id: "b", sourceNodeId: "image-b" },
            { id: "c", sourceNodeId: "image-c" },
        ];
        expect(reorderCanvasObjectReferences(references, "a", "c").map((reference) => reference.id)).toEqual(["b", "c", "a"]);
        expect(references.map((reference) => reference.id)).toEqual(["a", "b", "c"]);
    });

    it("keeps a resource node as its own fallback when it has no incoming connection", () => {
        const current = node("current-image", CanvasNodeType.Image, "Current image", { content: "blob:current-image" });

        expect(buildNodeMentionReferences(current, [current], [])).toMatchObject([
            {
                id: current.id,
                nodeId: current.id,
                kind: "image",
                previewUrl: "blob:current-image",
                active: true,
            },
        ]);
    });
});

function node(id: string, type: CanvasNodeType, title: string, metadata: CanvasNodeMetadata = {}): CanvasNodeData {
    return {
        id,
        type,
        title,
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata,
    };
}

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `${fromNodeId}->${toNodeId}`, fromNodeId, toNodeId };
}
