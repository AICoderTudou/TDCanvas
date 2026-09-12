import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        },
    });
});

const mocks = vi.hoisted(() => ({
    importLegacyCachedMedia: vi.fn(),
    cacheRemoteMedia: vi.fn(),
    readDesktopFileBlob: vi.fn(),
}));

vi.mock("@/services/platform/desktop-runtime", () => ({
    isTauriRuntime: () => true,
    isDesktopAssetUrl: (value?: string) => Boolean(value?.startsWith("asset://")),
    readDesktopFileBlob: mocks.readDesktopFileBlob,
}));

vi.mock("@/services/local-media-cache", () => ({
    cacheRemoteMedia: mocks.cacheRemoteMedia,
    importLegacyCachedMedia: mocks.importLegacyCachedMedia,
    isLocalMediaCacheUrl: (value?: string) => Boolean(value?.startsWith("/tdtv-media-cache/files/") || value?.startsWith("asset://")),
    localMediaCacheUrl: (path?: string) => (path ? `asset://${path}` : ""),
}));

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { hydrateCanvasImages } from "./canvas-generation-helpers";

describe("desktop canvas cache recovery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readDesktopFileBlob.mockRejectedValue(new Error("outside app-local scope"));
        mocks.cacheRemoteMedia.mockRejectedValue(new Error("provider should not be needed"));
        mocks.importLegacyCachedMedia.mockResolvedValue({
            localUrl: "asset://app-local/migrated-second.png",
            absolutePath: "C:\\app-local\\media-cache\\migrated-second.png",
            filename: "migrated-second.png",
            mimeType: "image/png",
            bytes: 42,
            contentHash: "a".repeat(64),
            cached: false,
        });
    });

    it("migrates the matching historical web cache output instead of selecting another batch image", async () => {
        const node: CanvasNodeData = {
            id: "image-one",
            type: CanvasNodeType.Image,
            title: "Generated image",
            position: { x: 0, y: 0 },
            width: 640,
            height: 480,
            metadata: {
                content: "/tdtv-media-cache/files/second.png",
                localPath: "C:\\workspace\\data\\media-cache\\second.png",
                filename: "second.png",
                mimeType: "image/png",
                providerResult: {
                    outputs: [
                        { kind: "image", url: "/tdtv-media-cache/files/first.png", sourceUrl: "https://cdn.example/first.png", localPath: "C:\\workspace\\data\\media-cache\\first.png", filename: "first.png" },
                        { kind: "image", url: "/tdtv-media-cache/files/second.png", sourceUrl: "https://cdn.example/second.png", localPath: "C:\\workspace\\data\\media-cache\\second.png", filename: "second.png" },
                    ],
                },
            },
        };

        const [hydrated] = await hydrateCanvasImages([node]);

        expect(mocks.importLegacyCachedMedia).toHaveBeenCalledWith("C:\\workspace\\data\\media-cache\\second.png", "https://cdn.example/second.png");
        expect(mocks.cacheRemoteMedia).not.toHaveBeenCalled();
        expect(hydrated.metadata).toMatchObject({
            content: "asset://app-local/migrated-second.png",
            localPath: "C:\\app-local\\media-cache\\migrated-second.png",
            filename: "migrated-second.png",
            bytes: 42,
        });
    });
});
