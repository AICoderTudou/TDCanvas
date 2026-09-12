import { createServer, request, type Server } from "node:http";
import { Readable } from "node:stream";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createPinnedLookup,
    handleMediaDownload,
    isAllowedPublicMediaAddress,
    parseCurlResponseHead,
    requestPublicMediaWithAddressFailover,
    TD_CANVAS_MEDIA_DOWNLOAD_PATH,
    type MediaDownloadProxyDependencies,
    type MediaDownloadUpstream,
    type PublicMediaTarget,
} from "./media-download-proxy";

type ProxyResponse = {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
};

describe("media download proxy contract", () => {
    let server: Server;
    let origin = "";
    const requestPublicMedia = vi.fn<NonNullable<MediaDownloadProxyDependencies["requestPublicMedia"]>>();

    beforeAll(async () => {
        server = createServer((req, res) => void handleMediaDownload(req, res, { requestPublicMedia }));
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => resolve());
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("测试代理未能监听本地端口");
        origin = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });

    beforeEach(() => {
        requestPublicMedia.mockReset();
    });

    it("rejects requests without the download marker header", async () => {
        const response = await postProxy(origin, "https://1.1.1.1/media.png", false);

        expect(response.status).toBe(403);
        expect(readJsonError(response)).toContain("缺少下载请求标识");
        expect(requestPublicMedia).not.toHaveBeenCalled();
    });

    it("rejects cross-site browser requests", async () => {
        const response = await postProxy(origin, "https://1.1.1.1/media.png", true, {
            Origin: "https://attacker.example",
            "Sec-Fetch-Site": "cross-site",
        });

        expect(response.status).toBe(403);
        expect(readJsonError(response)).toContain("不允许跨站调用");
        expect(requestPublicMedia).not.toHaveBeenCalled();
    });

    it.each([
        ["http://1.1.1.1/media.png", 400, "仅允许 HTTPS"],
        ["https://localhost/media.png", 403, "不允许访问本地地址"],
        ["https://127.0.0.1/media.png", 403, "不允许通过下载中转访问内网地址"],
        ["https://10.0.0.1/media.png", 403, "不允许通过下载中转访问内网地址"],
    ])("blocks unsafe target %s", async (url, status, message) => {
        const response = await postProxy(origin, url);

        expect(response.status).toBe(status);
        expect(readJsonError(response)).toContain(message);
        expect(requestPublicMedia).not.toHaveBeenCalled();
    });

    it("streams a legal public HTTPS media response with the proxy marker", async () => {
        const media = Buffer.from([137, 80, 78, 71]);
        requestPublicMedia.mockResolvedValue(upstream(media, 200, { "content-length": String(media.byteLength), "content-type": "image/png" }));

        const response = await postProxy(origin, "https://1.1.1.1/media.png");

        expect(response.status, response.body.toString("utf8")).toBe(200);
        expect(response.headers["content-type"]).toBe("image/png");
        expect(response.headers["content-disposition"]).toBe("attachment");
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.headers["x-tdcanvas-media-proxy"]).toBe("1");
        expect(response.body).toEqual(media);
        expect(requestPublicMedia).toHaveBeenCalledOnce();
        expect(requestPublicMedia.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                address: "1.1.1.1",
                family: 4,
                hostname: "1.1.1.1",
                url: new URL("https://1.1.1.1/media.png"),
            }),
        );
    });

    it("returns the pinned address in Node's dual-stack lookup shape", () => {
        const pinnedLookup = createPinnedLookup({
            address: "1.1.1.1",
            family: 4,
            hostname: "cdn.example",
            url: new URL("https://cdn.example/media.png"),
        });
        const callback = vi.fn();

        pinnedLookup("cdn.example", { all: true }, callback);

        expect(callback).toHaveBeenCalledWith(null, [{ address: "1.1.1.1", family: 4 }]);
    });

    it("allows a hostname resolved through a synthetic proxy address but blocks literal or private targets", () => {
        expect(isAllowedPublicMediaAddress({ address: "198.18.0.127", family: 4 }, false)).toBe(true);
        expect(isAllowedPublicMediaAddress({ address: "198.18.0.127", family: 4 }, true)).toBe(false);
        expect(isAllowedPublicMediaAddress({ address: "10.0.0.1", family: 4 }, false)).toBe(false);
    });

    it("parses the system curl response without mixing headers into the media body", () => {
        const parsed = parseCurlResponseHead(Buffer.from("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 4\r\n\r\nPNG!"));

        expect(parsed).toMatchObject({ statusCode: 200, headers: { "content-type": "image/png", "content-length": "4" } });
        expect(parsed?.body.toString("utf8")).toBe("PNG!");
    });

    it("falls back to the next validated public address when the first connection is refused", async () => {
        const response = upstream(Buffer.from("ok"), 200, { "content-type": "image/png" });
        const requestAddress = vi
            .fn<(target: PublicMediaTarget, signal: AbortSignal) => Promise<MediaDownloadUpstream>>()
            .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED 43.154.188.71:443"), { code: "ECONNREFUSED" }))
            .mockResolvedValueOnce(response);
        const target: PublicMediaTarget = {
            url: new URL("https://cdn.example/media.png"),
            hostname: "cdn.example",
            address: "43.154.188.71",
            family: 4,
            addresses: [
                { address: "43.154.188.71", family: 4 },
                { address: "1.1.1.1", family: 4 },
            ],
        };

        await expect(requestPublicMediaWithAddressFailover(target, new AbortController().signal, requestAddress, 1_000)).resolves.toBe(response);
        expect(requestAddress).toHaveBeenCalledTimes(2);
        expect(requestAddress.mock.calls.map(([candidate]) => candidate.address)).toEqual(["43.154.188.71", "1.1.1.1"]);
        expect(requestAddress.mock.calls[1][0]).toEqual(
            expect.objectContaining({
                hostname: "cdn.example",
                address: "1.1.1.1",
                family: 4,
                url: target.url,
            }),
        );
    });

    it("deduplicates validated addresses before attempting connections", async () => {
        const requestAddress = vi.fn<(target: PublicMediaTarget, signal: AbortSignal) => Promise<MediaDownloadUpstream>>().mockRejectedValue(new Error("offline"));
        const target: PublicMediaTarget = {
            url: new URL("https://cdn.example/media.png"),
            hostname: "cdn.example",
            address: "1.1.1.1",
            family: 4,
            addresses: [
                { address: "1.1.1.1", family: 4 },
                { address: "1.1.1.1", family: 4 },
                { address: "2606:4700:4700::1111", family: 6 },
            ],
        };

        await expect(requestPublicMediaWithAddressFailover(target, new AbortController().signal, requestAddress, 1_000)).rejects.toThrow("公网地址均连接失败");
        expect(requestAddress.mock.calls.map(([candidate]) => candidate.address)).toEqual(["1.1.1.1", "2606:4700:4700::1111"]);
    });

    it("clears the per-address connect timer after response headers arrive", async () => {
        const response = upstream(Buffer.from("slow body"), 200, { "content-type": "video/mp4" });
        let requestSignal: AbortSignal | undefined;
        const requestAddress = vi.fn<(target: PublicMediaTarget, signal: AbortSignal) => Promise<MediaDownloadUpstream>>(async (_target, signal) => {
            requestSignal = signal;
            return response;
        });
        const target: PublicMediaTarget = {
            url: new URL("https://cdn.example/slow.mp4"),
            hostname: "cdn.example",
            address: "1.1.1.1",
            family: 4,
        };

        await expect(requestPublicMediaWithAddressFailover(target, new AbortController().signal, requestAddress, 5)).resolves.toBe(response);
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));

        expect(requestSignal?.aborted).toBe(false);
    });

    it("revalidates redirects and blocks a public URL redirecting to private storage", async () => {
        requestPublicMedia.mockResolvedValue(upstream(Buffer.alloc(0), 302, { location: "https://127.0.0.1/private.png" }));

        const response = await postProxy(origin, "https://1.1.1.1/media.png");

        expect(response.status).toBe(403);
        expect(readJsonError(response)).toContain("不允许通过下载中转访问内网地址");
        expect(requestPublicMedia).toHaveBeenCalledOnce();
    });
});

function upstream(body: Buffer, statusCode: number, headers: Record<string, string>): MediaDownloadUpstream {
    return Object.assign(Readable.from([body]), { statusCode, headers });
}

function postProxy(origin: string, url: string, includeMarker = true, extraHeaders: Record<string, string> = {}) {
    const body = JSON.stringify({ url });
    return new Promise<ProxyResponse>((resolve, reject) => {
        const req = request(`${origin}${TD_CANVAS_MEDIA_DOWNLOAD_PATH}`, {
            method: "POST",
            headers: {
                "Content-Length": Buffer.byteLength(body),
                "Content-Type": "application/json",
                ...(includeMarker ? { "X-TDCanvas-Download": "1" } : {}),
                ...extraHeaders,
            },
        });
        req.once("error", reject);
        req.once("response", (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.once("error", reject);
            res.once("end", () =>
                resolve({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                }),
            );
        });
        req.end(body);
    });
}

function readJsonError(response: ProxyResponse) {
    return (JSON.parse(response.body.toString("utf8")) as { error?: string }).error || "";
}
