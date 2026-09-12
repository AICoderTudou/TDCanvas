import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Plugin } from "vite";

export const TD_CANVAS_MEDIA_DOWNLOAD_PATH = "/tdtv-media-download";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_CONNECT_ATTEMPT_TIMEOUT_MS = 15_000;
const MAX_UPSTREAM_HEADER_BYTES = 32 * 1024;

const blockedAddresses = new BlockList();
const syntheticProxyAddresses = new BlockList();
syntheticProxyAddresses.addSubnet("198.18.0.0", 15, "ipv4");
for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["192.88.99.0", 24],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const) {
    blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fec0::", 10],
    ["fe80::", 10],
    ["ff00::", 8],
] as const) {
    blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export class DownloadProxyError extends Error {
    constructor(
        message: string,
        readonly status = 502,
    ) {
        super(message);
    }
}

export type PublicMediaTarget = {
    url: URL;
    hostname: string;
    address: string;
    family: 4 | 6;
    addresses?: ReadonlyArray<PublicMediaAddress>;
};

export type PublicMediaAddress = Pick<PublicMediaTarget, "address" | "family">;

export type MediaDownloadUpstream = Readable & {
    statusCode?: number;
    headers: IncomingMessage["headers"];
};

export type MediaDownloadProxyDependencies = {
    requestPublicMedia?: (target: Readonly<PublicMediaTarget>, signal: AbortSignal) => Promise<MediaDownloadUpstream>;
};

type PinnedLookupCallback = {
    (error: NodeJS.ErrnoException | null, address: string, family: number): void;
    (error: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>): void;
};

export function createMediaDownloadProxyPlugin(): Plugin {
    const middleware = (req: IncomingMessage, res: ServerResponse) => void handleMediaDownload(req, res);
    return {
        name: "tdcanvas-media-download-proxy",
        configureServer(server) {
            server.middlewares.use(TD_CANVAS_MEDIA_DOWNLOAD_PATH, middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(TD_CANVAS_MEDIA_DOWNLOAD_PATH, middleware);
        },
    };
}

export async function handleMediaDownload(req: IncomingMessage, res: ServerResponse, dependencies: MediaDownloadProxyDependencies = {}) {
    try {
        if (req.method !== "POST") throw new DownloadProxyError("仅支持 POST 下载请求", 405);
        if (req.headers["x-tdcanvas-download"] !== "1") throw new DownloadProxyError("缺少下载请求标识", 403);
        if (
            !String(req.headers["content-type"] || "")
                .toLowerCase()
                .startsWith("application/json")
        )
            throw new DownloadProxyError("请求格式错误", 415);
        validateBrowserRequestOrigin(req);

        const body = await readRequestJson(req);
        const targetUrl = typeof body.url === "string" ? body.url : "";
        const response = await fetchPublicMedia(targetUrl, dependencies.requestPublicMedia);
        const contentType = String(response.headers["content-type"] || "application/octet-stream")
            .split(";", 1)[0]
            .trim()
            .toLowerCase();
        if (["text/html", "application/xhtml+xml"].includes(contentType)) {
            response.destroy();
            throw new DownloadProxyError("远程地址返回了网页而不是媒体文件");
        }
        const contentLength = Number(response.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
            response.destroy();
            throw new DownloadProxyError("远程文件超过 1GB 下载限制", 413);
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", "attachment");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-TDCanvas-Media-Proxy", "1");
        let received = 0;
        const limiter = new Transform({
            transform(chunk, _encoding, callback) {
                received += chunk.length;
                callback(received > MAX_MEDIA_BYTES ? new DownloadProxyError("远程文件超过 1GB 下载限制", 413) : null, chunk);
            },
        });
        await pipeline(response, limiter, res);
    } catch (error) {
        if (res.headersSent) {
            res.destroy(error instanceof Error ? error : undefined);
            return;
        }
        const status = error instanceof DownloadProxyError ? error.status : 502;
        const message = error instanceof Error ? error.message : String(error);
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ error: message }));
    }
}

function validateBrowserRequestOrigin(req: IncomingMessage) {
    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (fetchSite === "cross-site") throw new DownloadProxyError("不允许跨站调用下载中转", 403);

    const origin = String(req.headers.origin || "");
    if (!origin) return;
    let originHost = "";
    try {
        originHost = new URL(origin).host.toLowerCase();
    } catch {
        throw new DownloadProxyError("下载请求来源无效", 403);
    }
    if (originHost !== String(req.headers.host || "").toLowerCase()) throw new DownloadProxyError("不允许跨站调用下载中转", 403);
}

async function readRequestJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_REQUEST_BYTES) throw new DownloadProxyError("下载请求过大", 413);
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
        throw new DownloadProxyError("下载请求不是有效 JSON", 400);
    }
}

export async function fetchPublicMedia(input: string, requestPublicMedia = requestPinnedPublicMedia): Promise<MediaDownloadUpstream> {
    let current = await validatePublicMediaUrl(input);
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const response = await requestPublicMedia(current, signal);
        const status = response.statusCode || 502;
        if ([301, 302, 303, 307, 308].includes(status)) {
            const location = response.headers.location;
            response.destroy();
            if (!location) throw new DownloadProxyError("远程下载重定向缺少目标地址");
            if (redirect === MAX_REDIRECTS) throw new DownloadProxyError("远程下载重定向次数过多");
            current = await validatePublicMediaUrl(new URL(location, current.url).toString());
            continue;
        }
        if (status !== 200) {
            response.destroy();
            throw new DownloadProxyError(`远程下载失败（HTTP ${status}）`, status >= 400 && status < 500 ? status : 502);
        }
        return response;
    }
    throw new DownloadProxyError("远程下载重定向次数过多");
}

function requestPinnedPublicMedia(target: PublicMediaTarget, signal: AbortSignal): Promise<MediaDownloadUpstream> {
    if (target.family === 4 && syntheticProxyAddresses.check(target.address, "ipv4")) return requestPublicMediaWithSystemCurl(target, signal);
    return requestPublicMediaWithAddressFailover(target, signal);
}

function requestPublicMediaWithSystemCurl(target: PublicMediaTarget, signal: AbortSignal): Promise<MediaDownloadUpstream> {
    return new Promise((resolve, reject) => {
        const executable = process.platform === "win32" ? "curl.exe" : "curl";
        const child = spawn(
            executable,
            [
                "--silent",
                "--show-error",
                "--include",
                "--request",
                "GET",
                "--proto",
                "=https",
                "--connect-timeout",
                String(Math.ceil(DOWNLOAD_CONNECT_ATTEMPT_TIMEOUT_MS / 1000)),
                "--max-time",
                String(Math.ceil(DOWNLOAD_TIMEOUT_MS / 1000)),
                "--max-filesize",
                String(MAX_MEDIA_BYTES),
                "--user-agent",
                "TDCanvas-Media-Download/1.0",
                "--url",
                target.url.toString(),
            ],
            { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        const body = new PassThrough();
        const upstream = body as unknown as MediaDownloadUpstream;
        let settled = false;
        let headerBuffer = Buffer.alloc(0);
        let errorText = "";

        const fail = (error: Error) => {
            if (settled) {
                body.destroy(error);
                return;
            }
            settled = true;
            child.kill();
            reject(error);
        };
        const abort = () => fail(new DownloadProxyError("远程下载超时", 504));
        signal.addEventListener("abort", abort, { once: true });

        child.stderr.on("data", (chunk: Buffer) => {
            if (errorText.length < 4096) errorText += chunk.toString("utf8");
        });
        child.once("error", (error) => fail(new DownloadProxyError(`系统下载组件不可用（${error.message}）`)));
        child.stdout.on("data", (chunk: Buffer) => {
            if (settled) {
                body.write(chunk);
                return;
            }
            headerBuffer = Buffer.concat([headerBuffer, chunk]);
            if (headerBuffer.byteLength > MAX_UPSTREAM_HEADER_BYTES) {
                fail(new DownloadProxyError("远程响应头过大"));
                return;
            }
            let parsed;
            try {
                parsed = parseCurlResponseHead(headerBuffer);
            } catch (error) {
                fail(error instanceof Error ? error : new DownloadProxyError(String(error)));
                return;
            }
            if (!parsed) return;
            settled = true;
            upstream.statusCode = parsed.statusCode;
            upstream.headers = parsed.headers;
            resolve(upstream);
            if (parsed.body.byteLength) body.write(parsed.body);
        });
        child.stdout.once("end", () => body.end());
        child.once("close", (code) => {
            signal.removeEventListener("abort", abort);
            if (!settled) {
                fail(new DownloadProxyError(`系统下载失败${errorText.trim() ? `（${errorText.trim()}）` : code ? `（退出码 ${code}）` : ""}`));
                return;
            }
            if (code && !body.destroyed) body.destroy(new DownloadProxyError(`系统下载失败（${errorText.trim() || `退出码 ${code}`}）`));
        });
        body.once("close", () => {
            signal.removeEventListener("abort", abort);
            if (!child.killed) child.kill();
        });
    });
}

export function parseCurlResponseHead(buffer: Buffer) {
    const boundary = buffer.indexOf("\r\n\r\n");
    if (boundary < 0) return null;
    const lines = buffer.subarray(0, boundary).toString("latin1").split("\r\n");
    const statusMatch = /^HTTP\/\S+\s+(\d{3})\b/.exec(lines.shift() || "");
    if (!statusMatch) throw new DownloadProxyError("系统下载返回了无效响应头");
    const headers: IncomingMessage["headers"] = {};
    for (const line of lines) {
        const separator = line.indexOf(":");
        if (separator <= 0) continue;
        const name = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        const previous = headers[name];
        headers[name] = previous ? `${Array.isArray(previous) ? previous.join(", ") : previous}, ${value}` : value;
    }
    return { statusCode: Number(statusMatch[1]), headers, body: buffer.subarray(boundary + 4) };
}

type RequestPinnedPublicMediaAddress = (target: PublicMediaTarget, signal: AbortSignal) => Promise<MediaDownloadUpstream>;

export async function requestPublicMediaWithAddressFailover(
    target: PublicMediaTarget,
    signal: AbortSignal,
    requestAddress: RequestPinnedPublicMediaAddress = requestPinnedPublicMediaAddress,
    connectAttemptTimeoutMs = DOWNLOAD_CONNECT_ATTEMPT_TIMEOUT_MS,
): Promise<MediaDownloadUpstream> {
    const addresses = uniquePublicMediaAddresses(target.addresses?.length ? target.addresses : [target]);
    let lastError: unknown;

    for (const [index, address] of addresses.entries()) {
        if (signal.aborted) throw new DownloadProxyError("远程下载超时", 504);
        const connectController = new AbortController();
        const connectTimeout = setTimeout(() => connectController.abort(), connectAttemptTimeoutMs);
        const attemptSignal = AbortSignal.any([signal, connectController.signal]);
        try {
            return await requestAddress({ ...target, ...address, addresses }, attemptSignal);
        } catch (error) {
            if (signal.aborted) throw new DownloadProxyError("远程下载超时", 504);
            lastError = error;
            if (index < addresses.length - 1) continue;
        } finally {
            // The per-address timeout only protects DNS/TCP/TLS and response headers.
            // Once the response stream exists, aborting it after 15 seconds would
            // truncate otherwise healthy large videos. The outer signal still
            // enforces the overall transfer timeout.
            clearTimeout(connectTimeout);
        }
    }

    if (lastError instanceof DownloadProxyError) throw lastError;
    const detail = lastError instanceof Error ? lastError.message : String(lastError || "未知连接错误");
    throw new DownloadProxyError(`远程资源的公网地址均连接失败（${detail}）`);
}

function requestPinnedPublicMediaAddress(target: PublicMediaTarget, signal: AbortSignal): Promise<MediaDownloadUpstream> {
    return new Promise((resolve, reject) => {
        const request = httpsRequest(
            {
                protocol: "https:",
                hostname: target.hostname,
                port: 443,
                method: "GET",
                path: `${target.url.pathname}${target.url.search}`,
                headers: {
                    Accept: "*/*",
                    Connection: "close",
                    Host: target.url.host,
                    "User-Agent": "TDCanvas-Media-Download/1.0",
                },
                agent: false,
                maxHeaderSize: MAX_UPSTREAM_HEADER_BYTES,
                rejectUnauthorized: true,
                servername: isIP(target.hostname) ? undefined : target.hostname,
                signal,
                // Pin the validated address into the actual TLS connection. Resolving the
                // hostname again here would reopen a DNS-rebinding window.
                lookup: createPinnedLookup(target),
            },
            resolve,
        );
        request.once("error", (error) => {
            reject(signal.aborted ? new DownloadProxyError("远程下载超时", 504) : error);
        });
        request.end();
    });
}

export function createPinnedLookup(target: PublicMediaTarget) {
    return (_hostname: string, options: { all?: boolean }, callback: PinnedLookupCallback) => {
        if (options.all) {
            callback(null, [{ address: target.address, family: target.family }]);
            return;
        }
        callback(null, target.address, target.family);
    };
}

async function validatePublicMediaUrl(input: string): Promise<PublicMediaTarget> {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new DownloadProxyError("远程资源地址无效", 400);
    }
    if (url.protocol !== "https:") throw new DownloadProxyError("下载中转仅允许 HTTPS 资源", 400);
    if (url.username || url.password) throw new DownloadProxyError("远程资源地址不能包含账号信息", 400);
    if (url.port && url.port !== "443") throw new DownloadProxyError("远程资源端口不受支持", 400);
    const hostname = url.hostname
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "")
        .toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new DownloadProxyError("不允许访问本地地址", 403);

    let addresses;
    const literalFamily = isIP(hostname);
    if (literalFamily) {
        addresses = [{ address: hostname, family: literalFamily }];
    } else {
        try {
            addresses = await lookup(hostname, { all: true, verbatim: true });
        } catch {
            throw new DownloadProxyError("远程资源域名无法解析", 400);
        }
    }
    if (!addresses.length) throw new DownloadProxyError("远程资源域名没有可用地址", 400);
    const normalizedAddresses = uniquePublicMediaAddresses(addresses.map((entry) => normalizeResolvedAddress(entry.address, entry.family)));
    for (const entry of normalizedAddresses) if (!isAllowedPublicMediaAddress(entry, Boolean(literalFamily))) throw new DownloadProxyError("不允许通过下载中转访问内网地址", 403);
    // Prefer IPv4 when both families are available because many local Windows
    // development networks publish IPv6 DNS answers without IPv6 connectivity.
    const orderedAddresses = [...normalizedAddresses.filter((entry) => entry.family === 4), ...normalizedAddresses.filter((entry) => entry.family === 6)];
    const selected = orderedAddresses[0];
    return { url, hostname, address: selected.address, family: selected.family, addresses: orderedAddresses };
}

export function isAllowedPublicMediaAddress(entry: PublicMediaAddress, literalTarget: boolean) {
    const family = entry.family === 6 ? "ipv6" : "ipv4";
    if (!blockedAddresses.check(entry.address, family)) return true;
    // Clash and similar local proxy clients use RFC 2544's 198.18.0.0/15 as a
    // synthetic DNS range. A hostname resolved into that range is still fetched
    // with the original Host/SNI and normal CA verification, so the proxy can
    // safely route it while literal 198.18.x.x URLs remain blocked.
    return !literalTarget && entry.family === 4 && syntheticProxyAddresses.check(entry.address, "ipv4");
}

function uniquePublicMediaAddresses(addresses: ReadonlyArray<PublicMediaAddress>): PublicMediaAddress[] {
    const seen = new Set<string>();
    return addresses.filter((entry) => {
        const key = `${entry.family}:${entry.address}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizeResolvedAddress(address: string, family: number): { address: string; family: 4 | 6 } {
    if (family !== 6) return { address, family: 4 };

    // BlockList internally represents IPv4 as IPv4-mapped IPv6. Adding the whole
    // ::ffff:0:0/96 range would therefore also block every ordinary IPv4 address.
    // Normalize actual mapped answers instead, then apply the IPv4 deny-list.
    const lower = address.toLowerCase();
    const dotted = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
    if (dotted) {
        const octets = dotted.slice(1).map(Number);
        if (octets.every((octet) => octet <= 255)) return { address: octets.join("."), family: 4 };
    }
    const hexadecimal = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexadecimal) {
        const high = Number.parseInt(hexadecimal[1], 16);
        const low = Number.parseInt(hexadecimal[2], 16);
        return { address: `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`, family: 4 };
    }
    return { address, family: 6 };
}
