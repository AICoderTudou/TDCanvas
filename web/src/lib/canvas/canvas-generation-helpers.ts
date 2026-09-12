import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { cacheRemoteMedia, importLegacyCachedMedia, isLocalMediaCacheUrl, localMediaCacheUrl } from "@/services/local-media-cache";
import { isDesktopAssetUrl, isTauriRuntime, readDesktopFileBlob } from "@/services/platform/desktop-runtime";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasImageHistoryEntry, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const hydratedHistory = await hydrateImageHistory(node.metadata);
            const activeHistoryEntry = hydratedHistory?.imageHistory?.find((entry) => entry.id === hydratedHistory.activeImageHistoryId);
            let metadata = activeHistoryEntry
                ? {
                      ...hydratedHistory,
                      content: activeHistoryEntry.content,
                      storageKey: activeHistoryEntry.storageKey,
                      localPath: activeHistoryEntry.localPath,
                      filename: activeHistoryEntry.filename,
                      mimeType: activeHistoryEntry.mimeType,
                      bytes: activeHistoryEntry.bytes,
                      naturalWidth: activeHistoryEntry.naturalWidth,
                      naturalHeight: activeHistoryEntry.naturalHeight,
                  }
                : hydratedHistory;
            metadata = await hydrateGeneratedMediaDiskCache(metadata);
            const content = metadata?.content;
            const durableContent = durableCachedMediaUrl(metadata, content);
            if (durableContent) {
                if (metadata === node.metadata && durableContent === content) return node;
                return { ...node, metadata: { ...metadata, content: durableContent } };
            }
            const isStoredFileResult = metadata?.providerResult?.outputs?.some((output) => output.kind === "file");
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio || isStoredFileResult) && metadata?.storageKey) return { ...node, metadata: { ...metadata, content: await resolveMediaUrl(metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return metadata === node.metadata ? node : { ...node, metadata };
            if (metadata?.storageKey) return { ...node, metadata: { ...metadata, content: await resolveImageUrl(metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return { ...node, metadata };
            return { ...node, metadata: { ...metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

async function hydrateImageHistory(metadata: CanvasNodeMetadata | undefined) {
    if (!metadata?.imageHistory?.length) return metadata;
    const imageHistory = await Promise.all(metadata.imageHistory.map(hydrateImageHistoryEntry));
    return { ...metadata, imageHistory };
}

async function hydrateImageHistoryEntry(entry: CanvasImageHistoryEntry): Promise<CanvasImageHistoryEntry> {
    const remoteUrl = remoteMediaUrl(entry.sourceUrl, entry.content);
    const diskCopy = await recoverRuntimeDiskCopy(entry, remoteUrl);
    if (diskCopy.durable) return diskCopy.value;
    const recoverableEntry = diskCopy.value;
    if (recoverableEntry.storageKey) return { ...recoverableEntry, content: await resolveImageUrl(recoverableEntry.storageKey, recoverableEntry.content) };
    if (!recoverableEntry.content.startsWith("data:image/")) return recoverableEntry;
    const stored = await uploadImage(recoverableEntry.content);
    return {
        ...recoverableEntry,
        content: stored.url,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        bytes: stored.bytes,
        naturalWidth: stored.width,
        naturalHeight: stored.height,
    };
}

async function hydrateGeneratedMediaDiskCache(metadata: CanvasNodeMetadata | undefined) {
    if (!metadata) return metadata;
    const outputs = metadata.providerResult?.outputs || [];
    const output =
        outputs.find((item) => item.localPath && item.localPath === metadata.localPath) ||
        outputs.find((item) => item.url && item.url === metadata.content) ||
        outputs.find((item) => item.filename && item.filename === metadata.filename) ||
        outputs.find((item) => item.sourceUrl || /^https:\/\//i.test(item.url || ""));
    const remoteUrl = remoteMediaUrl(output?.sourceUrl, output?.url, metadata.content);
    return (await recoverRuntimeDiskCopy(metadata, remoteUrl, metadata.filename || output?.filename || output?.name)).value;
}

type RuntimeDiskValue = Pick<CanvasNodeMetadata, "content" | "localPath" | "filename" | "mimeType" | "bytes"> & { sourceUrl?: string };

async function recoverRuntimeDiskCopy<T extends RuntimeDiskValue>(value: T, remoteUrl?: string, preferredFilename?: string): Promise<{ value: T; durable: boolean }> {
    if (isTauriRuntime()) {
        let invalidLocalPath = false;
        if (value.localPath) {
            try {
                const blob = await readDesktopFileBlob(value.localPath, value.mimeType);
                if (blob?.size) return { value: { ...value, content: localMediaCacheUrl(value.localPath, value.filename) }, durable: true };
            } catch {
                invalidLocalPath = true;
            }
            if (invalidLocalPath && remoteUrl) {
                try {
                    const migrated = await importLegacyCachedMedia(value.localPath, remoteUrl);
                    return {
                        value: {
                            ...value,
                            content: migrated.localUrl,
                            sourceUrl: value.sourceUrl || remoteUrl,
                            localPath: migrated.absolutePath,
                            filename: migrated.filename,
                            mimeType: migrated.mimeType,
                            bytes: migrated.bytes,
                        },
                        durable: true,
                    };
                } catch {
                    // The verified legacy import may not apply; retry the provider below.
                }
            }
        }
        if (!invalidLocalPath && isDesktopAssetUrl(value.content)) return { value, durable: true };
    } else {
        const durableContent = durableCachedMediaUrl(value, value.content);
        if (durableContent) return { value: durableContent === value.content ? value : { ...value, content: durableContent }, durable: true };
    }

    if (remoteUrl) {
        try {
            const cached = await cacheRemoteMedia({ url: remoteUrl, filename: preferredFilename || value.filename });
            return {
                value: {
                    ...value,
                    content: cached.localUrl,
                    sourceUrl: value.sourceUrl || remoteUrl,
                    localPath: cached.absolutePath,
                    filename: cached.filename,
                    mimeType: cached.mimeType,
                    bytes: cached.bytes,
                },
                durable: true,
            };
        } catch {
            // Keep a browser copy or the provider URL available for a later retry.
        }
    }

    const fallback = isTauriRuntime() && value.localPath ? { ...value, content: remoteUrl || value.content, localPath: undefined } : value;
    return { value: fallback, durable: false };
}

function remoteMediaUrl(...candidates: Array<string | undefined>) {
    return candidates.find((candidate): candidate is string => Boolean(candidate && /^https:\/\//i.test(candidate)));
}

function durableCachedMediaUrl(metadata: Pick<CanvasNodeMetadata, "localPath" | "filename"> | Pick<CanvasImageHistoryEntry, "localPath" | "filename"> | undefined, content: string | undefined) {
    if (isTauriRuntime()) return isDesktopAssetUrl(content) ? content : undefined;
    if (metadata?.localPath) return localMediaCacheUrl(metadata.localPath, metadata.filename);
    if (isLocalMediaCacheUrl(content)) return content;
    return undefined;
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.metadata?.status !== "loading") return node;
        if (node.type === CanvasNodeType.Aitudou && node.metadata.providerTask?.taskId) {
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    status: "idle" as const,
                    errorDetails: undefined,
                    providerTask: {
                        ...node.metadata.providerTask,
                        phase: "stopped" as const,
                        message: "页面已重新载入，本地轮询已停止；远端任务可能仍在执行，可从节点恢复查询。",
                    },
                },
            };
        }
        return { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } };
    });
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal =
        params.horizontalAngle === 0
            ? i18n.t("canvas.generation.front")
            : params.horizontalAngle > 0
              ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle })
              : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
