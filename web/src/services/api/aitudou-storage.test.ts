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

import { persistAitudouRunResult } from "./aitudou-storage";

describe("persistAitudouRunResult", () => {
    it("stores a generated image on disk first and keeps a browser Blob copy", async () => {
        const remoteUrl = "https://cdn.example/generated.png";
        const localUrl = "/tdtv-media-cache/files/generated.png";
        const imageBlob = new Blob(["generated-image"], { type: "image/png" });
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(imageBlob, { status: 200 }));
        const cacheRemoteMedia = vi.fn(async () => ({
            localUrl,
            absolutePath: "C:\\workspace\\data\\media-cache\\generated.png",
            filename: "generated.png",
            mimeType: "image/png",
            bytes: imageBlob.size,
            contentHash: "a".repeat(64),
            cached: false,
        }));
        const storeImage = vi.fn(async () => ({
            url: "blob:stored-generated-image",
            storageKey: "image:stored-generated-image",
            width: 1024,
            height: 768,
            bytes: imageBlob.size,
            mimeType: "image/png",
        }));

        const persisted = await persistAitudouRunResult(
            {
                operationId: "image.generate",
                status: "succeeded",
                taskIds: ["task-1"],
                outputs: [{ kind: "image", url: remoteUrl, taskId: "task-1" }],
                raw: {},
                taskStates: [],
            },
            { fetchImpl, storeImage, cacheRemoteMedia },
        );

        expect(cacheRemoteMedia).toHaveBeenCalledWith({ url: remoteUrl });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(fetchImpl).toHaveBeenCalledWith(localUrl);
        expect(storeImage).toHaveBeenCalledWith(expect.any(Blob));
        expect(persisted.failures).toEqual([]);
        expect(persisted.diskFailures).toEqual([]);
        expect(persisted.browserFailures).toEqual([]);
        expect(persisted.result.outputs[0]).toMatchObject({
            kind: "image",
            sourceUrl: remoteUrl,
            url: localUrl,
            localPath: "C:\\workspace\\data\\media-cache\\generated.png",
            filename: "generated.png",
            storageKey: "image:stored-generated-image",
            width: 1024,
            height: 768,
            mimeType: "image/png",
        });
    });

    it.each(["video", "audio", "file"] as const)("keeps disk and browser copies for generated %s output", async (kind) => {
        const remoteUrl = `https://cdn.example/generated.${kind}`;
        const blob = new Blob([kind], { type: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "application/zip" });
        const cacheRemoteMedia = vi.fn(async () => ({
            localUrl: `/tdtv-media-cache/files/generated.${kind}`,
            absolutePath: `C:\\workspace\\data\\media-cache\\generated.${kind}`,
            filename: `generated.${kind}`,
            mimeType: blob.type,
            bytes: blob.size,
            contentHash: "b".repeat(64),
            cached: true,
        }));
        const storeMedia = vi.fn(async (_blob: Blob, prefix: string) => ({ url: `blob:${kind}`, storageKey: `${prefix}:one`, bytes: blob.size, mimeType: blob.type }));
        const persisted = await persistAitudouRunResult(
            { operationId: "test", status: "succeeded", taskIds: [], outputs: [{ kind, url: remoteUrl }], raw: {}, taskStates: [] },
            { fetchImpl: vi.fn<typeof fetch>(async () => new Response(blob)), cacheRemoteMedia, storeMedia },
        );

        expect(storeMedia).toHaveBeenCalledWith(expect.any(Blob), `aitudou-${kind}`);
        expect(persisted.result.outputs[0]).toMatchObject({ url: `/tdtv-media-cache/files/generated.${kind}`, sourceUrl: remoteUrl, localPath: `C:\\workspace\\data\\media-cache\\generated.${kind}`, storageKey: `aitudou-${kind}:one` });
        expect(persisted.diskFailures).toEqual([]);
        expect(persisted.failures).toEqual([]);
        expect(persisted.browserFailures).toEqual([]);
    });

    it("falls back to the guarded proxy and IndexedDB when disk caching is unavailable", async () => {
        const remoteUrl = "https://cdn.example/generated.png";
        const imageBlob = new Blob(["generated-image"], { type: "image/png" });
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            if (input === remoteUrl) throw new TypeError("Failed to fetch");
            return new Response(imageBlob, { status: 200, headers: { "X-TDCanvas-Media-Proxy": "1" } });
        });
        const storeImage = vi.fn(async () => ({ url: "blob:stored-generated-image", storageKey: "image:stored-generated-image", width: 1024, height: 768, bytes: imageBlob.size, mimeType: "image/png" }));

        const persisted = await persistAitudouRunResult(
            { operationId: "image.generate", status: "succeeded", taskIds: [], outputs: [{ kind: "image", url: remoteUrl }], raw: {}, taskStates: [] },
            { fetchImpl, storeImage, cacheRemoteMedia: vi.fn(async () => Promise.reject(new Error("disk offline"))) },
        );

        expect(fetchImpl).toHaveBeenNthCalledWith(1, remoteUrl);
        expect(fetchImpl).toHaveBeenNthCalledWith(2, "/tdtv-media-download", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-TDCanvas-Download": "1" },
            body: JSON.stringify({ url: remoteUrl }),
        });
        expect(persisted.diskFailures).toEqual([`${remoteUrl}: disk offline`]);
        expect(persisted.failures).toEqual([]);
        expect(persisted.browserFailures).toEqual([]);
        expect(persisted.result.outputs[0]).toMatchObject({ url: "blob:stored-generated-image", sourceUrl: remoteUrl, storageKey: "image:stored-generated-image" });
    });

    it("separates a disk warning from a final browser persistence failure", async () => {
        const remoteUrl = "https://cdn.example/generated.png";
        const persisted = await persistAitudouRunResult(
            { operationId: "image.generate", status: "succeeded", taskIds: [], outputs: [{ kind: "image", url: remoteUrl }], raw: {}, taskStates: [] },
            {
                fetchImpl: vi.fn<typeof fetch>(async () => new Response(new Blob(["image"], { type: "image/png" }))),
                cacheRemoteMedia: vi.fn(async () => Promise.reject(new Error("disk offline"))),
                storeImage: vi.fn(async () => Promise.reject(new Error("IndexedDB full"))),
            },
        );

        expect(persisted.diskFailures).toEqual([`${remoteUrl}: disk offline`]);
        expect(persisted.failures).toEqual([`${remoteUrl}: IndexedDB full`]);
        expect(persisted.browserFailures).toEqual([`${remoteUrl}: IndexedDB full`]);
        expect(persisted.result.outputs[0]).toMatchObject({ url: remoteUrl, sourceUrl: remoteUrl, persistenceError: "IndexedDB full" });
    });

    it("retains a successful disk path when the optional browser copy fails", async () => {
        const remoteUrl = "https://cdn.example/generated.png";
        const disk = {
            localUrl: "/tdtv-media-cache/files/generated.png",
            absolutePath: "C:\\workspace\\data\\media-cache\\generated.png",
            filename: "generated.png",
            mimeType: "image/png",
            bytes: 5,
            contentHash: "c".repeat(64),
            cached: false,
        };
        const persisted = await persistAitudouRunResult(
            { operationId: "image.generate", status: "succeeded", taskIds: [], outputs: [{ kind: "image", url: remoteUrl }], raw: {}, taskStates: [] },
            {
                fetchImpl: vi.fn<typeof fetch>(async () => new Response(new Blob(["image"], { type: "image/png" }))),
                cacheRemoteMedia: vi.fn(async () => disk),
                storeImage: vi.fn(async () => Promise.reject(new Error("IndexedDB full"))),
            },
        );

        expect(persisted.diskFailures).toEqual([]);
        expect(persisted.failures).toEqual([]);
        expect(persisted.browserFailures).toEqual([`${remoteUrl}: IndexedDB full`]);
        expect(persisted.result.outputs[0]).toMatchObject({ url: disk.localUrl, sourceUrl: remoteUrl, localPath: disk.absolutePath, filename: disk.filename });
        expect(persisted.result.outputs[0]?.persistenceError).toBeUndefined();
    });
});
