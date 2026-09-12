import { saveAs } from "file-saver";

import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { cacheRemoteMedia, importLegacyCachedMedia } from "@/services/local-media-cache";
import { isDesktopAssetUrl, readDesktopFileBlob, saveBlobToDownloads } from "@/services/platform/desktop-runtime";
import { captureDownloadFeedback, emitDownloadComplete } from "@/services/download-feedback";

export type DownloadableMediaKind = "image" | "video" | "audio" | "file";

export type DownloadableMedia = {
    kind: DownloadableMediaKind;
    url: string;
    storageKey?: string;
    localPath?: string;
    sourceUrl?: string;
    filename?: string;
    mimeType?: string;
};

type MediaDownloadDependencies = {
    fetchImpl: typeof fetch;
    getImageBlobImpl: typeof getImageBlob;
    getMediaBlobImpl: typeof getMediaBlob;
    cacheRemoteMediaImpl: typeof cacheRemoteMedia;
    importLegacyCachedMediaImpl: typeof importLegacyCachedMedia;
    readDesktopFileBlobImpl: typeof readDesktopFileBlob;
    saveImpl: (blob: Blob, filename: string) => void | Promise<void>;
};

const MIME_EXTENSIONS: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
    "audio/ogg": "ogg",
    "application/json": "json",
    "application/zip": "zip",
    "text/plain": "txt",
};

const defaultDependencies: MediaDownloadDependencies = {
    fetchImpl: fetch,
    getImageBlobImpl: getImageBlob,
    getMediaBlobImpl: getMediaBlob,
    cacheRemoteMediaImpl: cacheRemoteMedia,
    importLegacyCachedMediaImpl: importLegacyCachedMedia,
    readDesktopFileBlobImpl: readDesktopFileBlob,
    saveImpl: async (blob, filename) => {
        if (await saveBlobToDownloads(blob, filename)) return;
        saveAs(blob, filename);
    },
};

export async function downloadBlobBackedMedia(input: DownloadableMedia, dependencies: Partial<MediaDownloadDependencies> = {}) {
    const deps = { ...defaultDependencies, ...dependencies };
    const feedback = captureDownloadFeedback(input.kind, input.filename, input.url);
    const blob = await resolveDownloadBlob(input, deps);
    const filename = normalizeDownloadFilename(input.filename, blob.type || input.mimeType);
    await deps.saveImpl(blob, filename);
    emitDownloadComplete({ ...feedback, filename });
    return { blob, filename };
}

export async function resolveDownloadBlob(input: DownloadableMedia, dependencies: Partial<MediaDownloadDependencies> = {}) {
    const deps = { ...defaultDependencies, ...dependencies };
    let blob: Blob | null = null;
    let cacheError: unknown;
    let localPathError: unknown;
    let migrationError: unknown;
    let directError: unknown;

    // Image editing must be local-first. Provider URLs can expire or take tens of
    // seconds to fail, while the same node may already have a complete browser or
    // desktop copy.
    if (input.storageKey) {
        try {
            const stored = input.kind === "image" || input.storageKey.startsWith("image:") ? await deps.getImageBlobImpl(input.storageKey) : await deps.getMediaBlobImpl(input.storageKey);
            blob = stored?.size ? stored : null;
        } catch {
            blob = null;
        }
    }

    if (!blob && input.localPath) {
        try {
            blob = await deps.readDesktopFileBlobImpl(input.localPath, input.mimeType);
        } catch (error) {
            localPathError = error;
        }
    }

    // Local routes, blob/data URLs and Tauri asset URLs should be read before
    // touching the network. A packaged Tauri app cannot serve Vite's legacy
    // /tdtv-media-cache route, so failure here is recoverable below.
    if (!blob && input.url && !isRemoteHttpUrl(input.url)) {
        try {
            blob = await fetchDownloadBlob(deps.fetchImpl, input.url);
        } catch (error) {
            directError = error;
        }
    }

    const remoteUrl = firstRemoteUrl(input.url, input.sourceUrl);
    if (!blob && input.localPath && remoteUrl) {
        try {
            const migrated = await deps.importLegacyCachedMediaImpl(input.localPath, remoteUrl);
            blob = await deps.readDesktopFileBlobImpl(migrated.absolutePath, migrated.mimeType);
            if (!blob) blob = await fetchDownloadBlob(deps.fetchImpl, migrated.localUrl);
        } catch (error) {
            migrationError = error;
        }
    }

    // Historical provider URLs are backfilled only after every local source has
    // been exhausted, so editing remains instant and works offline.
    if (!blob && remoteUrl) {
        try {
            const cached = await deps.cacheRemoteMediaImpl({ url: remoteUrl, filename: input.filename }, { fetchImpl: deps.fetchImpl });
            blob = await deps.readDesktopFileBlobImpl(cached.absolutePath, cached.mimeType);
            if (!blob) blob = await fetchDownloadBlob(deps.fetchImpl, cached.localUrl);
        } catch (error) {
            cacheError = error;
        }
    }

    if (!blob && remoteUrl) {
        try {
            blob = await fetchDownloadBlob(deps.fetchImpl, remoteUrl);
        } catch (error) {
            directError = error;
            try {
                blob = await fetchProxiedDownloadBlob(deps.fetchImpl, remoteUrl);
            } catch (proxyError) {
                throw new Error(`资源下载失败：直接读取失败（${downloadErrorMessage(directError)}）；磁盘缓存失败（${downloadErrorMessage(cacheError)}）；代理下载失败（${downloadErrorMessage(proxyError)}）`);
            }
        }
    }

    if (!blob) {
        if (!input.url) throw new Error("资源地址为空");
        const details = [
            `资源下载失败：${downloadErrorMessage(directError)}`,
            localPathError ? `本地缓存读取失败（${downloadErrorMessage(localPathError)}）` : "",
            migrationError ? `旧缓存迁移失败（${downloadErrorMessage(migrationError)}）` : "",
        ].filter(Boolean);
        throw new Error(details.join("；"));
    }

    if (!blob.size) throw new Error("下载到的文件为空");
    const mimeType = blob.type || input.mimeType;
    return mimeType && mimeType !== blob.type ? blob.slice(0, blob.size, mimeType) : blob;
}

async function fetchDownloadBlob(fetchImpl: typeof fetch, url: string) {
    let response: Response;
    try {
        response = await fetchImpl(url);
    } catch {
        throw new Error("浏览器无法读取该资源");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    if (!blob.size) throw new Error("下载到的文件为空");
    return blob;
}

async function fetchProxiedDownloadBlob(fetchImpl: typeof fetch, url: string) {
    let response: Response;
    try {
        response = await fetchImpl("/tdtv-media-download", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-TDCanvas-Download": "1",
            },
            body: JSON.stringify({ url }),
        });
    } catch {
        throw new Error("代理服务无法连接");
    }
    if (!response.ok) {
        let proxyError = "";
        try {
            const payload: unknown = await response.json();
            if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") proxyError = payload.error.trim();
        } catch {
            // The proxy may return a non-JSON gateway error page.
        }
        throw new Error(proxyError || `HTTP ${response.status}`);
    }
    if (response.headers.get("X-TDCanvas-Media-Proxy") !== "1") throw new Error("代理响应缺少安全标识");

    const blob = await response.blob();
    if (!blob.size) throw new Error("代理返回的文件为空");
    return blob;
}

function isHttpUrl(url: string) {
    return /^https?:\/\//i.test(url);
}

function isRemoteHttpUrl(url: string) {
    return isHttpUrl(url) && !isDesktopAssetUrl(url);
}

function firstRemoteUrl(...urls: Array<string | undefined>) {
    return urls.find((url): url is string => Boolean(url && isRemoteHttpUrl(url)));
}

function downloadErrorMessage(error: unknown) {
    return error instanceof Error && error.message ? error.message : "未知错误";
}

export function normalizeDownloadFilename(filename?: string, mimeType?: string) {
    let candidate = (filename || "tdcanvas-download").trim();
    if (/^https?:\/\//i.test(candidate)) {
        try {
            candidate = decodeURIComponent(new URL(candidate).pathname.split("/").filter(Boolean).pop() || "tdcanvas-download");
        } catch {
            candidate = "tdcanvas-download";
        }
    }
    candidate = candidate
        .split(/[?#]/, 1)[0]
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/g, "")
        .trim();
    if (!candidate) candidate = "tdcanvas-download";
    const extension = MIME_EXTENSIONS[String(mimeType || "").toLowerCase()] || "bin";
    if (!/\.[a-z0-9]{1,10}$/i.test(candidate)) candidate += `.${extension}`;
    return candidate.length > 180 ? candidate.slice(0, 180) : candidate;
}

export function downloadFilenameFromTitle(title: string | undefined, fallbackFilename: string) {
    const customTitle = title?.trim();
    if (!customTitle) return fallbackFilename;
    if (/\.[a-z0-9]{1,10}$/i.test(customTitle)) return customTitle;
    const extension = fallbackFilename.split(/[?#]/, 1)[0].match(/\.([a-z0-9]{1,10})$/i)?.[0];
    return extension ? `${customTitle}${extension}` : customTitle;
}
