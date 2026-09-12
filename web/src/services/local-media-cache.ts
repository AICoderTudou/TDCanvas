import { desktopFileUrl, invokeDesktop, isDesktopAssetUrl, isTauriRuntime } from "@/services/platform/desktop-runtime";

export type LocalMediaCacheRequest = {
    url: string;
    filename?: string;
};

export type LocalMediaCacheResult = {
    localUrl: string;
    absolutePath: string;
    filename: string;
    mimeType: string;
    bytes: number;
    contentHash: string;
    cached: boolean;
};

export type LocalMediaCacheDependencies = {
    fetchImpl: typeof fetch;
};

export async function importLegacyCachedMedia(absolutePath: string, sourceUrl: string): Promise<LocalMediaCacheResult> {
    if (!isTauriRuntime()) throw new Error("旧网页缓存迁移只适用于 TDCanvas 桌面客户端");
    if (!absolutePath.trim() || !/^https:\/\//i.test(sourceUrl.trim())) throw new Error("旧网页缓存缺少可验证的来源信息");
    let nativeResult: Omit<LocalMediaCacheResult, "localUrl">;
    try {
        nativeResult = await invokeDesktop("import_legacy_cached_media", { absolutePath: absolutePath.trim(), sourceUrl: sourceUrl.trim() });
    } catch (error) {
        throw new Error(`旧网页缓存迁移失败（${errorMessage(error)}）`);
    }
    const result = { ...nativeResult, localUrl: desktopFileUrl(nativeResult.absolutePath) };
    if (!isLocalMediaCacheResult(result)) throw new Error("旧网页缓存迁移返回了无效数据");
    return result;
}

export async function cacheRemoteMedia(input: LocalMediaCacheRequest, dependencies: Partial<LocalMediaCacheDependencies> = {}): Promise<LocalMediaCacheResult> {
    const url = input.url.trim();
    if (!/^https:\/\//i.test(url)) throw new Error("本地磁盘缓存只支持远程 HTTPS 资源");

    const body: LocalMediaCacheRequest = { url };
    const filename = input.filename?.trim();
    if (filename) body.filename = filename;

    if (isTauriRuntime()) {
        let nativeResult: Omit<LocalMediaCacheResult, "localUrl">;
        try {
            nativeResult = await invokeDesktop("cache_remote_media", body);
        } catch (error) {
            throw new Error(`桌面素材缓存失败（${errorMessage(error)}）`);
        }
        const result = { ...nativeResult, localUrl: desktopFileUrl(nativeResult.absolutePath) };
        if (!isLocalMediaCacheResult(result)) throw new Error("桌面素材缓存返回了无效数据");
        return result;
    }

    let response: Response;
    try {
        response = await (dependencies.fetchImpl || fetch)("/tdtv-media-cache", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-TDCanvas-Media-Cache": "1",
            },
            body: JSON.stringify(body),
        });
    } catch (error) {
        throw new Error(`本地磁盘缓存服务无法连接（${errorMessage(error)}）`);
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        if (!response.ok) throw new Error(`本地磁盘缓存失败（HTTP ${response.status}）`);
        throw new Error("本地磁盘缓存返回了无效数据");
    }
    if (!response.ok) throw new Error(`本地磁盘缓存失败（${payloadError(payload) || `HTTP ${response.status}`}）`);
    if (!isLocalMediaCacheResult(payload)) throw new Error("本地磁盘缓存返回了无效数据");
    return payload;
}

export function isLocalMediaCacheUrl(value: string | undefined) {
    return Boolean(value?.startsWith(LOCAL_MEDIA_CACHE_FILE_PREFIX) || isDesktopAssetUrl(value));
}

export function localMediaCacheUrl(absolutePath: string | undefined, filename?: string) {
    if (absolutePath && isTauriRuntime()) return desktopFileUrl(absolutePath);
    const resolvedFilename = filename || absolutePath?.split(/[\\/]/).filter(Boolean).pop();
    return resolvedFilename ? `${LOCAL_MEDIA_CACHE_FILE_PREFIX}${encodeURIComponent(resolvedFilename)}` : "";
}

function isLocalMediaCacheResult(value: unknown): value is LocalMediaCacheResult {
    if (!value || typeof value !== "object") return false;
    const result = value as Record<string, unknown>;
    return (
        typeof result.localUrl === "string" &&
        isLocalMediaCacheUrl(result.localUrl) &&
        typeof result.absolutePath === "string" &&
        Boolean(result.absolutePath) &&
        typeof result.filename === "string" &&
        Boolean(result.filename) &&
        typeof result.mimeType === "string" &&
        Boolean(result.mimeType) &&
        typeof result.bytes === "number" &&
        Number.isSafeInteger(result.bytes) &&
        result.bytes >= 0 &&
        typeof result.contentHash === "string" &&
        /^[a-f0-9]{64}$/i.test(result.contentHash) &&
        typeof result.cached === "boolean"
    );
}

function payloadError(payload: unknown) {
    return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error.trim() : "";
}

function errorMessage(error: unknown) {
    return error instanceof Error && error.message ? error.message : "未知错误";
}
export const LOCAL_MEDIA_CACHE_FILE_PREFIX = "/tdtv-media-cache/files/";
