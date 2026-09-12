import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";
import { cacheRemoteMedia, type LocalMediaCacheRequest, type LocalMediaCacheResult } from "@/services/local-media-cache";

import type { AitudouRunResult } from "./aitudou";
import type { AitudouOutput } from "./aitudou-protocol";

export type AitudouPersistenceOptions = {
    fetchImpl?: typeof fetch;
    storeImage?: (blob: Blob) => Promise<UploadedImage>;
    storeMedia?: (blob: Blob, prefix: string) => Promise<UploadedFile>;
    cacheRemoteMedia?: (input: LocalMediaCacheRequest) => Promise<LocalMediaCacheResult>;
};

export type AitudouPersistenceResult = {
    result: AitudouRunResult;
    failures: string[];
    diskFailures: string[];
    browserFailures: string[];
};

export async function persistAitudouRunResult(result: AitudouRunResult, options: AitudouPersistenceOptions = {}): Promise<AitudouPersistenceResult> {
    const fetchImpl = options.fetchImpl || fetch;
    const cacheRemoteMediaImpl = options.cacheRemoteMedia || cacheRemoteMedia;
    const outputs: AitudouOutput[] = [];
    const failures: string[] = [];
    const diskFailures: string[] = [];
    const browserFailures: string[] = [];

    for (const output of result.outputs) {
        if (!output.url || !/^https?:\/\//i.test(output.url) || output.kind === "text") {
            outputs.push(output);
            continue;
        }

        const remoteUrl = output.url;
        let diskCache: LocalMediaCacheResult | undefined;
        let diskError: unknown;
        try {
            diskCache = await cacheRemoteMediaImpl({ url: remoteUrl, filename: output.filename || output.name });
        } catch (error) {
            diskError = error;
            diskFailures.push(`${remoteUrl}: ${errorMessage(error)}`);
        }

        try {
            let blob: Blob;
            if (diskCache) {
                try {
                    blob = await fetchReadableBlob(fetchImpl, diskCache.localUrl);
                } catch {
                    blob = await fetchOutputBlob(output, fetchImpl, diskError);
                }
            } else {
                blob = await fetchOutputBlob(output, fetchImpl, diskError);
            }

            const stored =
                output.kind === "image" ? await (options.storeImage || (await import("@/services/image-storage")).uploadImage)(blob) : await (options.storeMedia || (await import("@/services/file-storage")).uploadMediaFile)(blob, `aitudou-${output.kind}`);

            outputs.push({
                ...output,
                sourceUrl: output.sourceUrl || remoteUrl,
                url: diskCache?.localUrl || stored.url,
                localPath: diskCache?.absolutePath,
                filename: diskCache?.filename || output.filename,
                storageKey: stored.storageKey,
                bytes: diskCache?.bytes ?? stored.bytes,
                width: stored.width ?? output.width,
                height: stored.height ?? output.height,
                durationMs: ("durationMs" in stored ? stored.durationMs : undefined) ?? output.durationMs,
                mimeType: diskCache?.mimeType || stored.mimeType,
            });
        } catch (error) {
            const reason = errorMessage(error);
            browserFailures.push(`${remoteUrl}: ${reason}`);
            if (!diskCache) failures.push(`${remoteUrl}: ${reason}`);
            outputs.push({
                ...output,
                sourceUrl: output.sourceUrl || remoteUrl,
                url: diskCache?.localUrl || remoteUrl,
                localPath: diskCache?.absolutePath,
                filename: diskCache?.filename || output.filename,
                bytes: diskCache?.bytes ?? output.bytes,
                mimeType: diskCache?.mimeType || output.mimeType,
                persistenceError: diskCache ? undefined : reason,
            });
        }
    }

    return { result: { ...result, outputs }, failures, diskFailures, browserFailures };
}

async function fetchOutputBlob(output: AitudouOutput, fetchImpl: typeof fetch, diskError?: unknown) {
    const url = output.url!;
    try {
        return await fetchReadableBlob(fetchImpl, url);
    } catch (directError) {
        // Disk persistence was already attempted above, so only use the guarded relay here.
        const { resolveDownloadBlob } = await import("@/services/media-download");
        const fallbackFetch: typeof fetch = (input, init) => (input === url ? Promise.reject(directError) : fetchImpl(input, init));
        const cacheFailure = diskError || new Error("本地磁盘缓存未能提供可读副本");
        return resolveDownloadBlob(
            { kind: output.kind === "text" ? "file" : output.kind, url, mimeType: output.mimeType, filename: output.filename || output.name },
            {
                fetchImpl: fallbackFetch,
                cacheRemoteMediaImpl: async () => {
                    throw cacheFailure;
                },
            },
        );
    }
}

async function fetchReadableBlob(fetchImpl: typeof fetch, url: string) {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("empty response");
    return blob;
}

function errorMessage(error: unknown) {
    return error instanceof Error && error.message ? error.message : String(error);
}
