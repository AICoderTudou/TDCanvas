import { describe, expect, it, vi } from "vitest";

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

import { downloadBlobBackedMedia, downloadFilenameFromTitle, normalizeDownloadFilename, resolveDownloadBlob } from "./media-download";

const emptyImageStore = vi.fn(async () => null);
const emptyMediaStore = vi.fn(async () => null);

describe("canvas media downloads", () => {
    it("uses IndexedDB before touching an expiring provider URL", async () => {
        const stored = new Blob(["image"], { type: "image/png" });
        const fetchImpl = vi.fn<typeof fetch>();
        const cacheRemoteMediaImpl = vi.fn(async () => {
            throw new Error("cache unavailable");
        });
        const saveImpl = vi.fn();
        const result = await downloadBlobBackedMedia(
            { kind: "image", url: "https://cdn.example/image.png", storageKey: "image:one", filename: "result.png" },
            { fetchImpl, getImageBlobImpl: vi.fn(async () => stored), getMediaBlobImpl: emptyMediaStore, cacheRemoteMediaImpl, saveImpl },
        );

        expect(cacheRemoteMediaImpl).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(saveImpl).toHaveBeenCalledWith(stored, "result.png");
        expect(result.blob).toBe(stored);
    });

    it("reads a Tauri app-local cache path without fetching its asset URL", async () => {
        const diskBlob = new Blob(["desktop cache"], { type: "image/png" });
        const fetchImpl = vi.fn<typeof fetch>();
        const readDesktopFileBlobImpl = vi.fn(async () => diskBlob);
        const cacheRemoteMediaImpl = vi.fn();

        const result = await resolveDownloadBlob(
            { kind: "image", url: "http://asset.localhost/result.png", localPath: "C:\\app-local\\media-cache\\result.png", mimeType: "image/png" },
            { fetchImpl, getImageBlobImpl: emptyImageStore, getMediaBlobImpl: emptyMediaStore, readDesktopFileBlobImpl, cacheRemoteMediaImpl },
        );

        expect(result).toBe(diskBlob);
        expect(readDesktopFileBlobImpl).toHaveBeenCalledWith("C:\\app-local\\media-cache\\result.png", "image/png");
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(cacheRemoteMediaImpl).not.toHaveBeenCalled();
    });

    it("migrates a verified web cache path before retrying the provider", async () => {
        const migratedBlob = new Blob(["migrated cache"], { type: "image/png" });
        const importLegacyCachedMediaImpl = vi.fn(async () => ({
            localUrl: "http://asset.localhost/migrated.png",
            absolutePath: "C:\\app-local\\media-cache\\migrated.png",
            filename: "migrated.png",
            mimeType: "image/png",
            bytes: migratedBlob.size,
            contentHash: "a".repeat(64),
            cached: false,
        }));
        const readDesktopFileBlobImpl = vi.fn(async (path: string) => (path.includes("app-local") ? migratedBlob : Promise.reject(new Error("outside scope"))));
        const cacheRemoteMediaImpl = vi.fn();
        const fetchImpl = vi.fn<typeof fetch>(async () => {
            throw new Error("legacy route unavailable");
        });

        const result = await resolveDownloadBlob(
            {
                kind: "image",
                url: "/tdtv-media-cache/files/generated.png",
                localPath: "C:\\workspace\\data\\media-cache\\generated.png",
                sourceUrl: "https://cdn.example/generated.png",
            },
            { fetchImpl, getImageBlobImpl: emptyImageStore, getMediaBlobImpl: emptyMediaStore, importLegacyCachedMediaImpl, readDesktopFileBlobImpl, cacheRemoteMediaImpl },
        );

        expect(await result.text()).toBe("migrated cache");
        expect(importLegacyCachedMediaImpl).toHaveBeenCalledWith("C:\\workspace\\data\\media-cache\\generated.png", "https://cdn.example/generated.png");
        expect(cacheRemoteMediaImpl).not.toHaveBeenCalled();
    });

    it.each(["video", "audio", "file"] as const)("downloads %s storage through the media Blob store", async (kind) => {
        const stored = new Blob([kind], { type: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "application/octet-stream" });
        const getMediaBlobImpl = vi.fn(async () => stored);
        const saveImpl = vi.fn();
        await downloadBlobBackedMedia({ kind, url: "blob:revoked", storageKey: `${kind}:one`, filename: `result-${kind}` }, { fetchImpl: vi.fn<typeof fetch>(), getImageBlobImpl: emptyImageStore, getMediaBlobImpl, saveImpl });

        expect(getMediaBlobImpl).toHaveBeenCalledWith(`${kind}:one`);
        expect(saveImpl.mock.calls[0][0]).toBe(stored);
        expect(saveImpl.mock.calls[0][0]).toBeInstanceOf(Blob);
    });

    it.each(["throws", "returns an empty Blob"])("reads the durable local URL when IndexedDB %s", async (storeFailure) => {
        const diskBlob = new Blob(["disk copy"], { type: "image/png" });
        const localUrl = "/tdtv-media-cache/files/result.png";
        const getImageBlobImpl = vi.fn(async () => {
            if (storeFailure === "throws") throw new Error("IndexedDB unavailable");
            return new Blob([]);
        });
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(diskBlob, { status: 200 }));

        const result = await resolveDownloadBlob({ kind: "image", url: localUrl, storageKey: "image:cached" }, { fetchImpl, getImageBlobImpl, getMediaBlobImpl: emptyMediaStore });

        expect(await result.text()).toBe("disk copy");
        expect(fetchImpl).toHaveBeenCalledWith(localUrl);
    });

    it.each(["https://cdn.example/result.webp", "data:text/plain;base64,aGVsbG8=", "blob:available"])("fetches %s into a Blob before saving", async (url) => {
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Blob(["download"], { type: "image/webp" }), { status: 200 }));
        const cacheRemoteMediaImpl = vi.fn(async () => {
            throw new Error("cache unavailable");
        });
        const saveImpl = vi.fn();
        await downloadBlobBackedMedia({ kind: "image", url, filename: "result" }, { fetchImpl, getImageBlobImpl: emptyImageStore, getMediaBlobImpl: emptyMediaStore, cacheRemoteMediaImpl, saveImpl });

        expect(fetchImpl).toHaveBeenCalledWith(url);
        expect(saveImpl.mock.calls[0][0]).toBeInstanceOf(Blob);
        expect(typeof saveImpl.mock.calls[0][0]).not.toBe("string");
        expect(saveImpl).toHaveBeenCalledWith(expect.any(Blob), "result.webp");
    });

    it("persists a cross-origin resource to disk before using the legacy proxy", async () => {
        const cachedBlob = new Blob(["cached image"], { type: "image/png" });
        const localUrl = "/tdtv-media-cache/files/result.png";
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            if (input === "https://blocked.example/result.png") throw new TypeError("Failed to fetch");
            if (input === "/tdtv-media-cache")
                return Response.json({ localUrl, absolutePath: "C:\\workspace\\data\\media-cache\\result.png", filename: "result.png", mimeType: "image/png", bytes: cachedBlob.size, contentHash: "a".repeat(64), cached: false });
            if (input === localUrl) return new Response(cachedBlob, { status: 200 });
            throw new Error("legacy proxy should not be called");
        });
        const saveImpl = vi.fn();

        const result = await downloadBlobBackedMedia({ kind: "image", url: "https://blocked.example/result.png", filename: "result.png" }, { fetchImpl, getImageBlobImpl: emptyImageStore, getMediaBlobImpl: emptyMediaStore, saveImpl });

        expect(fetchImpl).toHaveBeenNthCalledWith(1, "/tdtv-media-cache", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-TDCanvas-Media-Cache": "1",
            },
            body: JSON.stringify({ url: "https://blocked.example/result.png", filename: "result.png" }),
        });
        expect(fetchImpl).toHaveBeenNthCalledWith(2, localUrl);
        expect(fetchImpl).not.toHaveBeenCalledWith("https://blocked.example/result.png");
        expect(await result.blob.text()).toBe("cached image");
        expect(saveImpl).toHaveBeenCalledWith(expect.any(Blob), "result.png");
        expect(typeof saveImpl.mock.calls[0][0]).not.toBe("string");
    });

    it("falls back to the guarded proxy when the disk cache service is unavailable", async () => {
        const proxied = new Blob(["proxied image"], { type: "image/png" });
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            if (input === "https://blocked.example/result.png") throw new TypeError("Failed to fetch");
            if (input === "/tdtv-media-cache") return Response.json({ error: "cache offline" }, { status: 503 });
            return new Response(proxied, { status: 200, headers: { "X-TDCanvas-Media-Proxy": "1" } });
        });

        const result = await resolveDownloadBlob({ kind: "image", url: "https://blocked.example/result.png" }, { fetchImpl, getImageBlobImpl: emptyImageStore, getMediaBlobImpl: emptyMediaStore });

        expect(await result.text()).toBe("proxied image");
        expect(fetchImpl).toHaveBeenLastCalledWith("/tdtv-media-download", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-TDCanvas-Download": "1" },
            body: JSON.stringify({ url: "https://blocked.example/result.png" }),
        });
    });

    it("rejects an unmarked proxy response without saving", async () => {
        const saveImpl = vi.fn();
        await expect(
            downloadBlobBackedMedia(
                { kind: "image", url: "https://blocked.example/result.png", filename: "result.png" },
                {
                    fetchImpl: vi.fn<typeof fetch>(async (input) => {
                        if (input === "https://blocked.example/result.png") throw new TypeError("Failed to fetch");
                        if (input === "/tdtv-media-cache") return Response.json({ error: "cache offline" }, { status: 503 });
                        return new Response("not a trusted proxy response", { status: 200 });
                    }),
                    getImageBlobImpl: emptyImageStore,
                    getMediaBlobImpl: emptyMediaStore,
                    saveImpl,
                },
            ),
        ).rejects.toThrow("代理响应缺少安全标识");
        expect(saveImpl).not.toHaveBeenCalled();
    });

    it("reports both the direct and proxy failures without saving", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            if (input === "https://blocked.example/result.png") return new Response("forbidden", { status: 403 });
            if (input === "/tdtv-media-cache") return Response.json({ error: "cache offline" }, { status: 503 });
            return new Response("proxy unavailable", { status: 502, headers: { "X-TDCanvas-Media-Proxy": "1" } });
        });
        const saveImpl = vi.fn();

        await expect(downloadBlobBackedMedia({ kind: "image", url: "https://blocked.example/result.png", filename: "result.png" }, { fetchImpl, getImageBlobImpl: emptyImageStore, getMediaBlobImpl: emptyMediaStore, saveImpl })).rejects.toThrow(
            "直接读取失败（HTTP 403）；磁盘缓存失败（本地磁盘缓存失败（cache offline））；代理下载失败（HTTP 502）",
        );
        expect(saveImpl).not.toHaveBeenCalled();
    });

    it("includes the proxy JSON error when a proxied download is rejected", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            if (input === "https://blocked.example/result.png") throw new TypeError("Failed to fetch");
            if (input === "/tdtv-media-cache") return Response.json({ error: "cache offline" }, { status: 503 });
            return Response.json({ error: "目标地址不在允许的下载范围内" }, { status: 403 });
        });

        await expect(resolveDownloadBlob({ kind: "image", url: "https://blocked.example/result.png" }, { fetchImpl, getImageBlobImpl: emptyImageStore, getMediaBlobImpl: emptyMediaStore })).rejects.toThrow("代理下载失败（目标地址不在允许的下载范围内）");
    });

    it.each(["blob:revoked", "data:text/plain;base64,"])("does not proxy a failed non-http URL: %s", async (url) => {
        const fetchImpl = vi.fn<typeof fetch>(async () => {
            throw new TypeError("Failed to fetch");
        });

        await expect(resolveDownloadBlob({ kind: "file", url }, { fetchImpl, getImageBlobImpl: emptyImageStore, getMediaBlobImpl: emptyMediaStore })).rejects.toThrow("浏览器无法读取该资源");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledWith(url);
    });

    it.each([
        [new Response("missing", { status: 404 }), "HTTP 404"],
        [new Response(new Blob([]), { status: 200 }), "文件为空"],
    ])("rejects invalid resource responses", async (response, expected) => {
        await expect(
            resolveDownloadBlob(
                { kind: "file", url: "https://cdn.example/file" },
                {
                    fetchImpl: vi.fn<typeof fetch>(async () => response),
                    getImageBlobImpl: emptyImageStore,
                    getMediaBlobImpl: emptyMediaStore,
                    cacheRemoteMediaImpl: vi.fn(async () => {
                        throw new Error("cache unavailable");
                    }),
                },
            ),
        ).rejects.toThrow(expected);
    });

    it("normalizes filenames and keeps existing extensions", () => {
        expect(normalizeDownloadFilename("portrait", "image/jpeg")).toBe("portrait.jpg");
        expect(normalizeDownloadFilename("clip", "video/webm")).toBe("clip.webm");
        expect(normalizeDownloadFilename("voice", "audio/mpeg")).toBe("voice.mp3");
        expect(normalizeDownloadFilename("already.png", "image/jpeg")).toBe("already.png");
        expect(normalizeDownloadFilename("bad:<name>?", "application/octet-stream")).toBe("bad__name_.bin");
        expect(normalizeDownloadFilename("https://cdn.example/path/result.png?token=secret", "image/png")).toBe("result.png");
    });

    it("uses the node's custom title while keeping the real file extension", () => {
        expect(downloadFilenameFromTitle("产品主视觉", "provider-result.webp")).toBe("产品主视觉.webp");
        expect(downloadFilenameFromTitle("成片.mp4", "provider-result.webm")).toBe("成片.mp4");
    });
});
