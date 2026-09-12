import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Plugin } from "vite";

import { fetchPublicMedia, type MediaDownloadProxyDependencies } from "./media-download-proxy";

export const TD_CANVAS_MEDIA_CACHE_PATH = "/tdtv-media-cache";

const MANIFEST_FILENAME = "manifest.json";
const MAX_REQUEST_BYTES = 16 * 1024;
const DEFAULT_MAX_MEDIA_BYTES = 1024 * 1024 * 1024;

const MEDIA_TYPES = {
    "application/x-subrip": "srt",
    "application/x-zip-compressed": "zip",
    "application/zip": "zip",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/midi": "mid",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/x-midi": "mid",
    "audio/x-wav": "wav",
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "text/vtt": "vtt",
} as const;

const EXTENSION_MEDIA_TYPES: Record<string, keyof typeof MEDIA_TYPES> = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([mimeType, extension]) => [extension, mimeType])) as Record<string, keyof typeof MEDIA_TYPES>;
EXTENSION_MEDIA_TYPES.jpeg = "image/jpeg";
EXTENSION_MEDIA_TYPES.midi = "audio/midi";
EXTENSION_MEDIA_TYPES.srt = "application/x-subrip";
EXTENSION_MEDIA_TYPES.vtt = "text/vtt";

export type MediaCacheEntry = {
    sourceUrlHash: string;
    source: string;
    filename: string;
    contentHash: string;
    mimeType: string;
    bytes: number;
    createdAt: string;
};

type MediaCacheManifest = {
    version: 1;
    sources: Record<string, MediaCacheEntry>;
};

export type CachedMediaResult = {
    localUrl: string;
    absolutePath: string;
    filename: string;
    mimeType: string;
    bytes: number;
    contentHash: string;
    cached: boolean;
};

export type MediaCacheOptions = {
    cacheDir: string;
    allowedDataRoot: string;
    maxMediaBytes?: number;
    requestPublicMedia?: MediaDownloadProxyDependencies["requestPublicMedia"];
    now?: () => Date;
};

class MediaCacheError extends Error {
    constructor(
        message: string,
        readonly status = 500,
    ) {
        super(message);
    }
}

export function createMediaCachePlugin(options: MediaCacheOptions): Plugin {
    const service = createMediaCacheService(options);
    const middleware = (req: IncomingMessage, res: ServerResponse) => void service.handle(req, res);
    return {
        name: "tdcanvas-local-media-cache",
        configureServer(server) {
            server.middlewares.use(TD_CANVAS_MEDIA_CACHE_PATH, middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(TD_CANVAS_MEDIA_CACHE_PATH, middleware);
        },
    };
}

export function createMediaCacheService(options: MediaCacheOptions) {
    const cacheDir = resolve(options.cacheDir);
    const allowedDataRoot = resolve(options.allowedDataRoot);
    const maxMediaBytes = options.maxMediaBytes ?? DEFAULT_MAX_MEDIA_BYTES;
    const now = options.now ?? (() => new Date());
    const inFlight = new Map<string, Promise<CachedMediaResult>>();
    let ready: Promise<void> | undefined;
    let commitQueue = Promise.resolve();

    const ensureReady = () => (ready ??= ensureSafeCacheDirectory(cacheDir, allowedDataRoot));
    const withCommitLock = async <T>(operation: () => Promise<T>) => {
        const previous = commitQueue;
        let release: () => void = () => {};
        commitQueue = new Promise<void>((resolveQueue) => {
            release = resolveQueue;
        });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    };

    const cacheRemoteMedia = async (sourceUrl: string, requestedFilename?: string): Promise<CachedMediaResult> => {
        await ensureReady();
        const sourceUrlHash = sha256(sourceUrl);
        const pending = inFlight.get(sourceUrlHash);
        if (pending) return pending;

        const task = (async () => {
            const existing = await findCachedSource(cacheDir, sourceUrlHash);
            if (existing) return toCacheResult(cacheDir, existing, true);

            const response = await fetchPublicMedia(sourceUrl, options.requestPublicMedia);
            let tempPath = "";
            try {
                const contentLength = Number(response.headers["content-length"]);
                if (Number.isFinite(contentLength) && contentLength > maxMediaBytes) {
                    response.destroy();
                    throw new MediaCacheError(`远程文件超过 ${formatByteLimit(maxMediaBytes)} 缓存限制`, 413);
                }
                const mimeType = resolveMediaType(response.headers["content-type"], sourceUrl, requestedFilename);
                const extension = MEDIA_TYPES[mimeType];
                const stem = chooseReadableStem(requestedFilename, sourceUrl, sourceUrlHash);
                tempPath = resolve(cacheDir, `.incoming-${process.pid}-${randomUUID()}.tmp`);
                const hasher = createHash("sha256");
                let bytes = 0;
                const limiter = new Transform({
                    transform(chunk, _encoding, callback) {
                        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                        bytes += buffer.byteLength;
                        if (bytes > maxMediaBytes) {
                            callback(new MediaCacheError(`远程文件超过 ${formatByteLimit(maxMediaBytes)} 缓存限制`, 413));
                            return;
                        }
                        hasher.update(buffer);
                        callback(null, buffer);
                    },
                });
                await pipeline(response, limiter, await createAtomicWriteStream(tempPath));
                const contentHash = hasher.digest("hex");

                return await withCommitLock(async () => {
                    const manifest = await readManifest(cacheDir);
                    const duplicate = manifest.sources[sourceUrlHash];
                    if (duplicate && (await isManifestFileAvailable(cacheDir, duplicate))) {
                        await rm(tempPath, { force: true });
                        tempPath = "";
                        return toCacheResult(cacheDir, duplicate, true);
                    }

                    const filename = await chooseAvailableFilename(cacheDir, manifest, `${stem}.${extension}`, contentHash);
                    const absolutePath = resolveCacheFile(cacheDir, filename);
                    if (await fileExists(absolutePath)) {
                        await rm(tempPath, { force: true });
                    } else {
                        await rename(tempPath, absolutePath);
                    }
                    tempPath = "";
                    const entry: MediaCacheEntry = {
                        sourceUrlHash,
                        source: redactSourceUrl(sourceUrl),
                        filename,
                        contentHash,
                        mimeType,
                        bytes,
                        createdAt: now().toISOString(),
                    };
                    manifest.sources[sourceUrlHash] = entry;
                    await writeManifest(cacheDir, manifest);
                    return toCacheResult(cacheDir, entry, false);
                });
            } catch (error) {
                response.destroy();
                if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
                throw error;
            }
        })();
        inFlight.set(sourceUrlHash, task);
        try {
            return await task;
        } finally {
            inFlight.delete(sourceUrlHash);
        }
    };

    const handle = async (req: IncomingMessage, res: ServerResponse) => {
        try {
            await ensureReady();
            const pathname = cacheRequestPath(req.url);
            if (req.method === "POST" && pathname === "/") {
                validateCacheWriteRequest(req);
                const body = await readRequestJson(req);
                const sourceUrl = typeof body.url === "string" ? body.url.trim() : "";
                const filename = typeof body.filename === "string" ? body.filename : undefined;
                if (!sourceUrl) throw new MediaCacheError("缺少远程媒体地址", 400);
                const result = await cacheRemoteMedia(sourceUrl, filename);
                sendJson(res, 200, result);
                return;
            }
            if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/files/")) {
                await serveCachedMedia(req, res, cacheDir, pathname.slice("/files/".length));
                return;
            }
            throw new MediaCacheError("本地媒体缓存接口不存在", 404);
        } catch (error) {
            if (res.headersSent) {
                res.destroy(error instanceof Error ? error : undefined);
                return;
            }
            const status = errorStatus(error);
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, status, { error: message });
        }
    };

    return { handle, cacheRemoteMedia, cacheDir };
}

export function resolveMediaCacheDirectory(repoRoot: string, configured = process.env.TD_CANVAS_MEDIA_CACHE_DIR) {
    const absoluteRepoRoot = resolve(repoRoot);
    const dataRoot = resolve(absoluteRepoRoot, "data");
    let cacheDir = resolve(dataRoot, "media-cache");
    if (configured?.trim()) {
        const value = configured.trim();
        cacheDir = isAbsolute(value) ? resolve(value) : /^[\\/]*data[\\/]/i.test(value) ? resolve(absoluteRepoRoot, value) : resolve(dataRoot, value);
    }
    assertCachePath(dataRoot, cacheDir);
    return { dataRoot, cacheDir };
}

async function ensureSafeCacheDirectory(cacheDir: string, allowedDataRoot: string) {
    assertCachePath(allowedDataRoot, cacheDir);
    await mkdir(allowedDataRoot, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    const [realAllowedRoot, realCacheDir] = await Promise.all([realpath(allowedDataRoot), realpath(cacheDir)]);
    assertCachePath(realAllowedRoot, realCacheDir);
}

function assertCachePath(allowedDataRoot: string, cacheDir: string) {
    if (!isPathInside(resolve(allowedDataRoot), resolve(cacheDir)) || resolve(allowedDataRoot) === resolve(cacheDir)) {
        throw new Error("媒体缓存目录必须位于项目 data 目录的子目录中");
    }
}

function isPathInside(parent: string, child: string) {
    const pathFromParent = relative(parent, child);
    return Boolean(pathFromParent) && !pathFromParent.startsWith("..") && !isAbsolute(pathFromParent);
}

async function findCachedSource(cacheDir: string, sourceUrlHash: string) {
    const manifest = await readManifest(cacheDir);
    const entry = manifest.sources[sourceUrlHash];
    return entry && (await isManifestFileAvailable(cacheDir, entry)) ? entry : undefined;
}

async function readManifest(cacheDir: string): Promise<MediaCacheManifest> {
    try {
        const parsed = JSON.parse(await readFile(resolve(cacheDir, MANIFEST_FILENAME), "utf8")) as Partial<MediaCacheManifest>;
        if (parsed.version !== 1 || !parsed.sources || typeof parsed.sources !== "object") throw new Error("invalid manifest");
        return { version: 1, sources: parsed.sources };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sources: {} };
        throw new MediaCacheError("本地媒体缓存清单损坏，请检查 data/media-cache/manifest.json");
    }
}

async function writeManifest(cacheDir: string, manifest: MediaCacheManifest) {
    const temporary = resolve(cacheDir, `.manifest-${process.pid}-${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        await rename(temporary, resolve(cacheDir, MANIFEST_FILENAME));
    } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function createAtomicWriteStream(path: string) {
    const { createWriteStream } = await import("node:fs");
    return createWriteStream(path, { flags: "wx" });
}

function resolveMediaType(header: string | string[] | undefined, sourceUrl: string, requestedFilename?: string): keyof typeof MEDIA_TYPES {
    const contentType = String(Array.isArray(header) ? header[0] : header || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
    if (contentType in MEDIA_TYPES) return contentType as keyof typeof MEDIA_TYPES;
    if (contentType && contentType !== "application/octet-stream" && contentType !== "text/plain") throw new MediaCacheError(`不支持缓存此资源类型：${contentType}`, 415);

    const candidates = [requestedFilename, safeUrlPathname(sourceUrl)];
    for (const candidate of candidates) {
        const extension = extname(candidate || "")
            .slice(1)
            .toLowerCase();
        if (EXTENSION_MEDIA_TYPES[extension]) return EXTENSION_MEDIA_TYPES[extension];
    }
    throw new MediaCacheError("远程资源没有可识别的图片、视频、音频或生成文件类型", 415);
}

function chooseReadableStem(requestedFilename: string | undefined, sourceUrl: string, sourceUrlHash: string) {
    const candidate = requestedFilename || basename(safeUrlPathname(sourceUrl)) || `generated-media-${sourceUrlHash.slice(0, 12)}`;
    const withoutExtension = candidate.slice(0, candidate.length - extname(candidate).length);
    let stem = withoutExtension
        .normalize("NFKC")
        .replace(/[\\/]+/g, "-")
        .replace(/[^\p{L}\p{N}._-]+/gu, "-")
        .replace(/^[._-]+|[._-]+$/g, "")
        .slice(0, 96);
    if (!stem) stem = `generated-media-${sourceUrlHash.slice(0, 12)}`;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `asset-${stem}`;
    return stem;
}

async function chooseAvailableFilename(cacheDir: string, manifest: MediaCacheManifest, preferred: string, contentHash: string) {
    const matchingEntry = Object.values(manifest.sources).find((entry) => entry.filename === preferred && entry.contentHash === contentHash);
    if (matchingEntry && (await isManifestFileAvailable(cacheDir, matchingEntry))) return preferred;
    if (!(await fileExists(resolveCacheFile(cacheDir, preferred)))) return preferred;
    const extension = extname(preferred);
    const stem = preferred.slice(0, -extension.length);
    return `${stem}-${contentHash.slice(0, 8)}${extension}`;
}

async function isManifestFileAvailable(cacheDir: string, entry: MediaCacheEntry) {
    try {
        const info = await stat(resolveCacheFile(cacheDir, entry.filename));
        return info.isFile() && info.size === entry.bytes;
    } catch {
        return false;
    }
}

function toCacheResult(cacheDir: string, entry: MediaCacheEntry, cached: boolean): CachedMediaResult {
    return {
        localUrl: `${TD_CANVAS_MEDIA_CACHE_PATH}/files/${encodeURIComponent(entry.filename)}`,
        absolutePath: resolveCacheFile(cacheDir, entry.filename),
        filename: entry.filename,
        mimeType: entry.mimeType,
        bytes: entry.bytes,
        contentHash: entry.contentHash,
        cached,
    };
}

async function serveCachedMedia(req: IncomingMessage, res: ServerResponse, cacheDir: string, encodedFilename: string) {
    let filename: string;
    try {
        filename = decodeURIComponent(encodedFilename);
    } catch {
        throw new MediaCacheError("本地媒体文件名无效", 400);
    }
    if (!filename || filename !== basename(filename) || filename.includes("\\") || filename === MANIFEST_FILENAME) {
        throw new MediaCacheError("本地媒体文件名无效", 400);
    }
    const manifest = await readManifest(cacheDir);
    const entry = Object.values(manifest.sources).find((item) => item.filename === filename);
    if (!entry) throw new MediaCacheError("本地媒体不存在", 404);
    const absolutePath = resolveCacheFile(cacheDir, filename);
    let info;
    try {
        info = await stat(absolutePath);
    } catch {
        throw new MediaCacheError("本地媒体不存在", 404);
    }
    if (!info.isFile()) throw new MediaCacheError("本地媒体不存在", 404);

    const range = parseByteRange(req.headers.range, info.size);
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, info.size - 1);
    const length = info.size === 0 ? 0 : end - start + 1;
    res.statusCode = range ? 206 : 200;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", length);
    res.setHeader("Content-Type", entry.mimeType);
    res.setHeader("ETag", `\"sha256-${entry.contentHash}\"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-TDCanvas-Local-Media", "1");
    if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    if (req.method === "HEAD" || info.size === 0) {
        res.end();
        return;
    }
    await pipeline(createReadStream(absolutePath, { start, end }), res);
}

function parseByteRange(header: string | undefined, size: number) {
    if (!header) return undefined;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (!match[1] && !match[2]) || size === 0) throw new MediaCacheError("请求的媒体范围无效", 416);
    let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    let end = match[2] && match[1] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
        throw new MediaCacheError("请求的媒体范围无效", 416);
    }
    end = Math.min(end, size - 1);
    return { start, end };
}

function validateCacheWriteRequest(req: IncomingMessage) {
    if (req.headers["x-tdcanvas-media-cache"] !== "1") throw new MediaCacheError("缺少本地缓存请求标识", 403);
    if (
        !String(req.headers["content-type"] || "")
            .toLowerCase()
            .startsWith("application/json")
    )
        throw new MediaCacheError("请求格式错误", 415);
    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (fetchSite === "cross-site") throw new MediaCacheError("不允许跨站写入本地媒体缓存", 403);
    const origin = String(req.headers.origin || "");
    if (!origin) return;
    let originHost = "";
    try {
        originHost = new URL(origin).host.toLowerCase();
    } catch {
        throw new MediaCacheError("本地缓存请求来源无效", 403);
    }
    if (originHost !== String(req.headers.host || "").toLowerCase()) throw new MediaCacheError("不允许跨站写入本地媒体缓存", 403);
}

async function readRequestJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > MAX_REQUEST_BYTES) throw new MediaCacheError("本地缓存请求过大", 413);
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
        throw new MediaCacheError("本地缓存请求不是有效 JSON", 400);
    }
}

function cacheRequestPath(requestUrl = "/") {
    const pathname = new URL(requestUrl, "http://tdcanvas.local").pathname;
    const stripped = pathname.startsWith(TD_CANVAS_MEDIA_CACHE_PATH) ? pathname.slice(TD_CANVAS_MEDIA_CACHE_PATH.length) : pathname;
    return stripped || "/";
}

function resolveCacheFile(cacheDir: string, filename: string) {
    const path = resolve(cacheDir, filename);
    if (!isPathInside(cacheDir, path)) throw new MediaCacheError("本地媒体文件名无效", 400);
    return path;
}

function redactSourceUrl(input: string) {
    try {
        const url = new URL(input);
        return `${url.origin}${url.pathname}`;
    } catch {
        return "";
    }
}

function safeUrlPathname(input: string) {
    try {
        return new URL(input).pathname;
    } catch {
        return "";
    }
}

function sha256(value: string | Buffer) {
    return createHash("sha256").update(value).digest("hex");
}

async function fileExists(path: string) {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

function formatByteLimit(bytes: number) {
    if (bytes >= 1024 * 1024 * 1024) return `${bytes / (1024 * 1024 * 1024)}GB`;
    if (bytes >= 1024 * 1024) return `${bytes / (1024 * 1024)}MB`;
    return `${bytes}B`;
}

function errorStatus(error: unknown) {
    if (error instanceof MediaCacheError) return error.status;
    if (typeof error === "object" && error && "status" in error && typeof error.status === "number") return error.status;
    return 502;
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(JSON.stringify(value));
}
