import { describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

import { buildNodeGenerationInputs } from "./canvas-node-generation";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

const targetNode = node("target", CanvasNodeType.Video, "Video generation");

describe("buildNodeGenerationInputs uploaded materials", () => {
    it("globally gets a generated image result from the current canvas without a connection", () => {
        const generated = node("generated-image", CanvasNodeType.Image, "Character result", {
            content: "asset://generated-character.png",
            localPath: "C:\\TDCanvas\\media-cache\\generated-character.png",
            mimeType: "image/png",
            sourceOrigin: "generated",
            canvasSetEnabled: true,
        });
        const target = node("object-mode-target", CanvasNodeType.Video, "Video generation", {
            objectReferences: [{ id: "get-character", sourceNodeId: generated.id, versionMode: "latest" }],
        });

        expect(buildNodeGenerationInputs(target.id, [generated, target], [])).toEqual([
            {
                nodeId: generated.id,
                type: "image",
                title: "Character result",
                image: {
                    id: generated.id,
                    name: "Character result.png",
                    type: "image/png",
                    dataUrl: "asset://generated-character.png",
                    localPath: "C:\\TDCanvas\\media-cache\\generated-character.png",
                },
            },
        ]);
    });

    it("maps a directly connected uploaded image with its local URL, MIME type, and storage key", () => {
        const image = node("uploaded-image", CanvasNodeType.Image, "reference-frame.webp", {
            content: "blob:uploaded-image",
            storageKey: "image:reference-frame",
            localPath: "C:\\TDCanvas\\media-cache\\reference-frame.webp",
            mimeType: "image/webp",
            bytes: 24_576,
            naturalWidth: 1536,
            naturalHeight: 1024,
            sourceOrigin: "upload",
        });

        const inputs = buildNodeGenerationInputs(targetNode.id, [image, targetNode], [connection(image.id, targetNode.id)]);

        expect(image.metadata).toMatchObject({ sourceOrigin: "upload", bytes: 24_576, naturalWidth: 1536, naturalHeight: 1024 });
        expect(inputs).toEqual([
            {
                nodeId: image.id,
                type: "image",
                title: "reference-frame.webp",
                image: {
                    id: image.id,
                    name: "reference-frame.webp",
                    type: "image/webp",
                    dataUrl: "blob:uploaded-image",
                    storageKey: "image:reference-frame",
                    localPath: "C:\\TDCanvas\\media-cache\\reference-frame.webp",
                },
            },
        ]);
    });

    it("maps a directly connected uploaded video without losing URL, MIME, byte, duration, or dimensions", () => {
        const video = node("uploaded-video", CanvasNodeType.Video, "motion-reference", {
            content: "blob:uploaded-video",
            storageKey: "video:motion-reference",
            localPath: "C:\\TDCanvas\\media-cache\\motion-reference.mov",
            mimeType: "video/quicktime",
            bytes: 8_388_608,
            naturalWidth: 1920,
            naturalHeight: 1080,
            durationMs: 8_420,
            sourceOrigin: "upload",
        });

        const inputs = buildNodeGenerationInputs(targetNode.id, [video, targetNode], [connection(video.id, targetNode.id)]);

        expect(inputs).toEqual([
            {
                nodeId: video.id,
                type: "video",
                title: "motion-reference",
                video: {
                    id: video.id,
                    name: "motion-reference.mov",
                    type: "video/quicktime",
                    url: "blob:uploaded-video",
                    storageKey: "video:motion-reference",
                    localPath: "C:\\TDCanvas\\media-cache\\motion-reference.mov",
                    bytes: 8_388_608,
                    width: 1920,
                    height: 1080,
                    durationMs: 8_420,
                },
            },
        ]);
    });

    it("maps a directly connected uploaded audio with its URL, MIME type, storage key, and duration", () => {
        const audio = node("uploaded-audio", CanvasNodeType.Audio, "voice-reference", {
            content: "blob:uploaded-audio",
            storageKey: "audio:voice-reference",
            localPath: "C:\\TDCanvas\\media-cache\\voice-reference.wav",
            mimeType: "audio/wav",
            bytes: 1_048_576,
            durationMs: 12_340,
            sourceOrigin: "upload",
        });

        const inputs = buildNodeGenerationInputs(targetNode.id, [audio, targetNode], [connection(audio.id, targetNode.id)]);

        expect(audio.metadata).toMatchObject({ sourceOrigin: "upload", bytes: 1_048_576 });
        expect(inputs).toEqual([
            {
                nodeId: audio.id,
                type: "audio",
                title: "voice-reference",
                audio: {
                    id: audio.id,
                    name: "voice-reference.wav",
                    type: "audio/wav",
                    url: "blob:uploaded-audio",
                    storageKey: "audio:voice-reference",
                    localPath: "C:\\TDCanvas\\media-cache\\voice-reference.wav",
                    durationMs: 12_340,
                },
            },
        ]);
    });

    it("ignores uploaded materials that do not have a direct incoming connection to the target", () => {
        const connected = node("connected-image", CanvasNodeType.Image, "connected", {
            content: "blob:connected-image",
            storageKey: "image:connected",
            mimeType: "image/png",
            sourceOrigin: "upload",
        });
        const unconnectedImage = node("unconnected-image", CanvasNodeType.Image, "unconnected-image", {
            content: "blob:unconnected-image",
            storageKey: "image:unconnected",
            mimeType: "image/png",
            sourceOrigin: "upload",
        });
        const unconnectedVideo = node("unconnected-video", CanvasNodeType.Video, "unconnected-video", {
            content: "blob:unconnected-video",
            storageKey: "video:unconnected",
            mimeType: "video/mp4",
            sourceOrigin: "upload",
        });
        const unconnectedAudio = node("unconnected-audio", CanvasNodeType.Audio, "unconnected-audio", {
            content: "blob:unconnected-audio",
            storageKey: "audio:unconnected",
            mimeType: "audio/mpeg",
            sourceOrigin: "upload",
        });

        const inputs = buildNodeGenerationInputs(targetNode.id, [connected, unconnectedImage, unconnectedVideo, unconnectedAudio, targetNode], [connection(connected.id, targetNode.id), connection(unconnectedVideo.id, unconnectedAudio.id)]);

        expect(inputs.map((input) => input.nodeId)).toEqual([connected.id]);
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
