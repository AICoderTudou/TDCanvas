import { describe, expect, it, vi } from "vitest";

import { cacheRemoteMedia, isLocalMediaCacheUrl, type LocalMediaCacheResult } from "./local-media-cache";

const cachedResult: LocalMediaCacheResult = {
    localUrl: "/tdtv-media-cache/files/generated-image.png",
    absolutePath: "C:\\workspace\\data\\media-cache\\generated-image.png",
    filename: "generated-image.png",
    mimeType: "image/png",
    bytes: 15,
    contentHash: "a".repeat(64),
    cached: false,
};

describe("local media cache client", () => {
    it("writes a remote resource through the same-origin disk cache endpoint", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(cachedResult));

        await expect(cacheRemoteMedia({ url: " https://cdn.example/generated.png ", filename: " generated.png " }, { fetchImpl })).resolves.toEqual(cachedResult);
        expect(fetchImpl).toHaveBeenCalledWith("/tdtv-media-cache", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-TDCanvas-Media-Cache": "1",
            },
            body: JSON.stringify({ url: "https://cdn.example/generated.png", filename: "generated.png" }),
        });
    });

    it("accepts a cache hit without changing its local identity", async () => {
        const hit = { ...cachedResult, cached: true };
        await expect(cacheRemoteMedia({ url: "https://cdn.example/generated.png" }, { fetchImpl: vi.fn<typeof fetch>(async () => Response.json(hit)) })).resolves.toEqual(hit);
    });

    it("surfaces endpoint and transport errors", async () => {
        await expect(cacheRemoteMedia({ url: "https://cdn.example/generated.png" }, { fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ error: "远程资源暂不可用" }, { status: 502 })) })).rejects.toThrow("远程资源暂不可用");
        await expect(cacheRemoteMedia({ url: "https://cdn.example/generated.png" }, { fetchImpl: vi.fn<typeof fetch>(async () => Promise.reject(new Error("offline"))) })).rejects.toThrow("offline");
    });

    it("rejects malformed cache responses and non-http sources", async () => {
        await expect(cacheRemoteMedia({ url: "https://cdn.example/generated.png" }, { fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ ...cachedResult, localUrl: "https://evil.example/file" })) })).rejects.toThrow("无效数据");
        await expect(cacheRemoteMedia({ url: "http://cdn.example/generated.png" }, { fetchImpl: vi.fn<typeof fetch>() })).rejects.toThrow("只支持远程 HTTPS");
        await expect(cacheRemoteMedia({ url: "blob:generated" }, { fetchImpl: vi.fn<typeof fetch>() })).rejects.toThrow("只支持远程 HTTPS");
    });

    it("recognizes only stable same-origin cache file URLs", () => {
        expect(isLocalMediaCacheUrl("/tdtv-media-cache/files/generated-image.png")).toBe(true);
        expect(isLocalMediaCacheUrl("blob:temporary")).toBe(false);
        expect(isLocalMediaCacheUrl("https://cdn.example/generated-image.png")).toBe(false);
    });
});
