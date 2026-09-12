import { resolveDownloadBlob, type DownloadableMedia } from "@/services/media-download";

export type CanvasImageOperationSource = {
    url: string;
    storageKey?: string;
    localPath?: string;
    sourceUrl?: string;
    filename?: string;
    mimeType?: string;
};

type CanvasImageOperationSourceDependencies = {
    resolveBlob: (input: DownloadableMedia) => Promise<Blob>;
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
};

const defaultDependencies: CanvasImageOperationSourceDependencies = {
    resolveBlob: (input) => resolveDownloadBlob(input),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

export async function resolveCanvasImageOperationBlob(source: CanvasImageOperationSource, dependencies: Partial<CanvasImageOperationSourceDependencies> = {}) {
    const deps = { ...defaultDependencies, ...dependencies };
    return deps.resolveBlob({
        kind: "image",
        url: source.url,
        ...(source.storageKey ? { storageKey: source.storageKey } : {}),
        ...(source.localPath ? { localPath: source.localPath } : {}),
        ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
        ...(source.filename ? { filename: source.filename } : {}),
        ...(source.mimeType ? { mimeType: source.mimeType } : {}),
    });
}

/**
 * Canvas drawing must use a same-origin/blob source. Remote AI result URLs can be
 * displayed by <img>, but drawing them directly taints the canvas and makes
 * crop/split export fail. Resolve the stored Blob (or the guarded media proxy)
 * first and keep the temporary object URL alive only for the operation.
 */
export async function withCanvasImageOperationSource<T>(source: CanvasImageOperationSource, operation: (localUrl: string) => Promise<T>, dependencies: Partial<CanvasImageOperationSourceDependencies> = {}) {
    const deps = { ...defaultDependencies, ...dependencies };
    const blob = await resolveCanvasImageOperationBlob(source, deps);
    const localUrl = deps.createObjectURL(blob);
    try {
        return await operation(localUrl);
    } finally {
        deps.revokeObjectURL(localUrl);
    }
}
