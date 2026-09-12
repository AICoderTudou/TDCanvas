import { createServer, request, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaCacheService, resolveMediaCacheDirectory, TD_CANVAS_MEDIA_CACHE_PATH, type CachedMediaResult } from "./media-cache";
import type { MediaDownloadProxyDependencies, MediaDownloadUpstream } from "./media-download-proxy";

type TestResponse = {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
};

describe("local media cache contract", () => {
    let server: Server | undefined;
    let origin = "";
    let testRoot = "";
    let cacheDir = "";
    const requestPublicMedia = vi.fn<NonNullable<MediaDownloadProxyDependencies["requestPublicMedia"]>>();

    beforeEach(async () => {
        requestPublicMedia.mockReset();
        testRoot = await mkdtemp(join(tmpdir(), "tdcanvas-media-cache-"));
        const dataRoot = join(testRoot, "data");
        cacheDir = join(dataRoot, "media-cache");
        const service = createMediaCacheService({ cacheDir, allowedDataRoot: dataRoot, requestPublicMedia, maxMediaBytes: 32 });
        server = createServer((req, res) => void service.handle(req, res));
        await new Promise<void>((resolveListen, reject) => {
            server?.once("error", reject);
            server?.listen(0, "127.0.0.1", resolveListen);
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("测试缓存服务未能监听本地端口");
        origin = `http://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
        if (server) await new Promise<void>((resolveClose, reject) => server?.close((error) => (error ? reject(error) : resolveClose())));
        if (testRoot) await rm(testRoot, { recursive: true, force: true });
    });

    it("atomically caches a remote asset under a readable name and serves it locally", async () => {
        const media = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]);
        requestPublicMedia.mockResolvedValue(upstream(media, "image/png"));

        const first = await postCache(origin, { url: "https://1.1.1.1/result?id=signed-token", filename: "task-42-image-0.png" });
        expect(first.status, first.body.toString("utf8")).toBe(200);
        const cached = JSON.parse(first.body.toString("utf8")) as CachedMediaResult;
        expect(cached).toEqual(
            expect.objectContaining({
                absolutePath: resolve(cacheDir, "task-42-image-0.png"),
                bytes: media.byteLength,
                cached: false,
                filename: "task-42-image-0.png",
                localUrl: `${TD_CANVAS_MEDIA_CACHE_PATH}/files/task-42-image-0.png`,
                mimeType: "image/png",
            }),
        );
        expect(await readFile(cached.absolutePath)).toEqual(media);

        const local = await get(`${origin}${cached.localUrl}`);
        expect(local.status).toBe(200);
        expect(local.headers["content-type"]).toBe("image/png");
        expect(local.headers["x-tdcanvas-local-media"]).toBe("1");
        expect(local.body).toEqual(media);

        const manifest = JSON.parse(await readFile(resolve(cacheDir, "manifest.json"), "utf8")) as {
            sources: Record<string, { source: string; filename: string }>;
        };
        expect(Object.values(manifest.sources)).toEqual([expect.objectContaining({ source: "https://1.1.1.1/result", filename: "task-42-image-0.png" })]);
    });

    it("deduplicates the same source URL without contacting the remote host twice", async () => {
        requestPublicMedia.mockResolvedValue(upstream(Buffer.from("cached"), "image/webp"));
        const payload = { url: "https://1.1.1.1/result.webp?signature=stable", filename: "scene.webp" };

        const first = await postCache(origin, payload);
        const second = await postCache(origin, payload);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect((JSON.parse(second.body.toString("utf8")) as CachedMediaResult).cached).toBe(true);
        expect(requestPublicMedia).toHaveBeenCalledOnce();
    });

    it("adds a short content hash when two different assets request the same filename", async () => {
        requestPublicMedia.mockResolvedValueOnce(upstream(Buffer.from("first"), "image/png")).mockResolvedValueOnce(upstream(Buffer.from("second"), "image/png"));

        const first = await postCache(origin, { url: "https://1.1.1.1/a.png", filename: "result.png" });
        const second = await postCache(origin, { url: "https://1.0.0.1/b.png", filename: "result.png" });
        const firstResult = JSON.parse(first.body.toString("utf8")) as CachedMediaResult;
        const secondResult = JSON.parse(second.body.toString("utf8")) as CachedMediaResult;

        expect(firstResult.filename).toBe("result.png");
        expect(secondResult.filename).toMatch(/^result-[a-f0-9]{8}\.png$/);
        expect(await readFile(firstResult.absolutePath, "utf8")).toBe("first");
        expect(await readFile(secondResult.absolutePath, "utf8")).toBe("second");
    });

    it("supports byte ranges for locally cached videos", async () => {
        requestPublicMedia.mockResolvedValue(upstream(Buffer.from("0123456789"), "video/mp4"));
        const cachedResponse = await postCache(origin, { url: "https://1.1.1.1/clip.mp4", filename: "clip.mp4" });
        const cached = JSON.parse(cachedResponse.body.toString("utf8")) as CachedMediaResult;

        const ranged = await get(`${origin}${cached.localUrl}`, { Range: "bytes=2-5" });

        expect(ranged.status).toBe(206);
        expect(ranged.headers["content-range"]).toBe("bytes 2-5/10");
        expect(ranged.body.toString("utf8")).toBe("2345");
    });

    it.each([
        ["Suno MIDI", "audio/midi", "song.mid", "audio/midi"],
        ["ZIP file", "application/octet-stream", "stems.zip", "application/zip"],
        ["WebVTT subtitle", "text/plain", "captions.vtt", "text/vtt"],
    ])("caches documented %s outputs", async (_label, upstreamType, filename, expectedType) => {
        requestPublicMedia.mockResolvedValue(upstream(Buffer.from("file"), upstreamType));

        const response = await postCache(origin, { url: `https://1.1.1.1/${filename}`, filename });
        expect(response.status, response.body.toString("utf8")).toBe(200);
        const cached = JSON.parse(response.body.toString("utf8")) as CachedMediaResult;
        expect(cached).toEqual(expect.objectContaining({ filename, mimeType: expectedType }));

        const local = await get(`${origin}${cached.localUrl}`);
        expect(local.status).toBe(200);
        expect(local.headers["content-type"]).toBe(expectedType);
        expect(local.body.toString("utf8")).toBe("file");
    });

    it("rejects unsupported or oversized responses without leaving a cached file", async () => {
        requestPublicMedia.mockResolvedValueOnce(upstream(Buffer.from("<html>bad</html>"), "text/html"));
        const unsupported = await postCache(origin, { url: "https://1.1.1.1/not-media", filename: "bad.png" });
        expect(unsupported.status).toBe(415);
        expect(readError(unsupported)).toContain("不支持缓存");

        requestPublicMedia.mockResolvedValueOnce(upstream(Buffer.alloc(0), "image/png", { "content-length": "33" }));
        const oversized = await postCache(origin, { url: "https://1.1.1.1/too-large.png", filename: "large.png" });
        expect(oversized.status).toBe(413);
        expect(readError(oversized)).toContain("缓存限制");
    });

    it("keeps cache writes same-origin and lets the shared downloader reject unsafe URLs", async () => {
        const crossSite = await postCache(origin, { url: "https://1.1.1.1/media.png" }, { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" });
        expect(crossSite.status).toBe(403);
        expect(requestPublicMedia).not.toHaveBeenCalled();

        const unsafe = await postCache(origin, { url: "http://127.0.0.1/private.png" });
        expect(unsafe.status).toBe(400);
        expect(readError(unsafe)).toContain("仅允许 HTTPS");
        expect(requestPublicMedia).not.toHaveBeenCalled();
    });
});

describe("media cache directory boundary", () => {
    it("defaults to repo/data/media-cache and rejects paths outside repo/data", () => {
        const repoRoot = resolve("C:/workspace/TDCanvas");
        expect(resolveMediaCacheDirectory(repoRoot)).toEqual({
            dataRoot: resolve(repoRoot, "data"),
            cacheDir: resolve(repoRoot, "data/media-cache"),
        });
        expect(resolveMediaCacheDirectory(repoRoot, "alternate-cache").cacheDir).toBe(resolve(repoRoot, "data/alternate-cache"));
        expect(resolveMediaCacheDirectory(repoRoot, "data/custom-cache").cacheDir).toBe(resolve(repoRoot, "data/custom-cache"));
        expect(() => resolveMediaCacheDirectory(repoRoot, resolve(repoRoot, "outside"))).toThrow("必须位于项目 data 目录");
    });
});

function upstream(body: Buffer, contentType: string, extraHeaders: Record<string, string> = {}): MediaDownloadUpstream {
    return Object.assign(Readable.from([body]), {
        statusCode: 200,
        headers: { "content-length": String(body.byteLength), "content-type": contentType, ...extraHeaders },
    });
}

function postCache(origin: string, payload: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
    const body = JSON.stringify(payload);
    return send(`${origin}${TD_CANVAS_MEDIA_CACHE_PATH}`, "POST", body, {
        "Content-Length": String(Buffer.byteLength(body)),
        "Content-Type": "application/json",
        "X-TDCanvas-Media-Cache": "1",
        ...extraHeaders,
    });
}

function get(url: string, headers: Record<string, string> = {}) {
    return send(url, "GET", undefined, headers);
}

function send(url: string, method: string, body?: string, headers: Record<string, string> = {}) {
    return new Promise<TestResponse>((resolveResponse, reject) => {
        const req = request(url, { method, headers });
        req.once("error", reject);
        req.once("response", (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.once("error", reject);
            res.once("end", () =>
                resolveResponse({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                }),
            );
        });
        req.end(body);
    });
}

function readError(response: TestResponse) {
    return (JSON.parse(response.body.toString("utf8")) as { error?: string }).error || "";
}
