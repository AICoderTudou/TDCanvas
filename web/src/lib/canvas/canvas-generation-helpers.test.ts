import { describe, expect, it, vi } from "vitest";

const cacheRemoteMediaMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/local-media-cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/local-media-cache")>()),
    cacheRemoteMedia: cacheRemoteMediaMock,
}));

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
            clear: () => values.clear(),
        },
    });
});

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import { hydrateCanvasImages } from "./canvas-generation-helpers";

describe("hydrateCanvasImages durable media", () => {
    it("preserves a stable disk-cache URL instead of replacing it with a Blob URL", async () => {
        const localUrl = "/tdtv-media-cache/files/generated-image.png";
        const node = mediaNode(CanvasNodeType.Image, {
            content: localUrl,
            filename: "generated-image.png",
            localPath: "C:\\workspace\\data\\media-cache\\generated-image.png",
            storageKey: "image:browser-copy",
        });

        const [hydrated] = await hydrateCanvasImages([node]);

        expect(hydrated).toBe(node);
        expect(hydrated.metadata?.content).toBe(localUrl);
    });

    it("repairs a previously persisted Blob URL from its durable local path", async () => {
        const node = mediaNode(CanvasNodeType.Video, {
            content: "blob:expired-browser-url",
            filename: "generated video.mp4",
            localPath: "C:\\workspace\\data\\media-cache\\generated video.mp4",
            storageKey: "video:browser-copy",
        });

        const [hydrated] = await hydrateCanvasImages([node]);

        expect(hydrated.metadata?.content).toBe("/tdtv-media-cache/files/generated%20video.mp4");
        expect(hydrated.metadata?.localPath).toBe(node.metadata?.localPath);
        expect(hydrated.metadata?.storageKey).toBe(node.metadata?.storageKey);
    });

    it("hydrates every saved image version and keeps the active version selected", async () => {
        const node = mediaNode(CanvasNodeType.Image, {
            content: "blob:expired-latest",
            filename: "latest.png",
            localPath: "C:\\workspace\\data\\media-cache\\latest.png",
            activeImageHistoryId: "latest",
            imageHistory: [
                {
                    id: "previous",
                    content: "blob:expired-previous",
                    filename: "previous.png",
                    localPath: "C:\\workspace\\data\\media-cache\\previous.png",
                    createdAt: "2026-08-23T00:00:00.000Z",
                },
                {
                    id: "latest",
                    content: "blob:expired-latest",
                    filename: "latest.png",
                    localPath: "C:\\workspace\\data\\media-cache\\latest.png",
                    createdAt: "2026-08-23T00:01:00.000Z",
                },
            ],
        });

        const [hydrated] = await hydrateCanvasImages([node]);

        expect(hydrated.metadata?.content).toBe("/tdtv-media-cache/files/latest.png");
        expect(hydrated.metadata?.imageHistory?.map((entry) => entry.content)).toEqual(["/tdtv-media-cache/files/previous.png", "/tdtv-media-cache/files/latest.png"]);
    });

    it("retries a failed generated asset into the disk cache on project load", async () => {
        cacheRemoteMediaMock.mockResolvedValueOnce({
            localUrl: "/tdtv-media-cache/files/recovered.png",
            absolutePath: "C:\\workspace\\data\\media-cache\\recovered.png",
            filename: "recovered.png",
            mimeType: "image/png",
            bytes: 2048,
            contentHash: "a".repeat(64),
            cached: false,
        });
        const node = mediaNode(CanvasNodeType.Image, {
            content: "https://cdn.example.com/temporary-result",
            providerResult: {
                outputs: [{ kind: "image", url: "https://cdn.example.com/temporary-result", sourceUrl: "https://cdn.example.com/temporary-result" }],
            },
        });

        const [hydrated] = await hydrateCanvasImages([node]);

        expect(cacheRemoteMediaMock).toHaveBeenCalledWith({ url: "https://cdn.example.com/temporary-result", filename: undefined });
        expect(hydrated.metadata).toMatchObject({
            content: "/tdtv-media-cache/files/recovered.png",
            localPath: "C:\\workspace\\data\\media-cache\\recovered.png",
            filename: "recovered.png",
            mimeType: "image/png",
            bytes: 2048,
        });
    });
});

function mediaNode(type: CanvasNodeType.Image | CanvasNodeType.Video, metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return {
        id: `node-${type}`,
        type,
        title: type,
        position: { x: 0, y: 0 },
        width: 640,
        height: 360,
        metadata,
    };
}
