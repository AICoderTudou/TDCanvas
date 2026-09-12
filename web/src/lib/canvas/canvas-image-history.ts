import { CanvasNodeType, type AitudouProviderTask, type CanvasImageHistoryEntry, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { AitudouOutput } from "@/services/api/aitudou-protocol";

export const MAX_CANVAS_IMAGE_HISTORY = 24;

export function shouldReplaceImageNodeOnGeneration(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image;
}

export function shouldKeepGeneratedOutputInImageHistory(node: CanvasNodeData, output: Pick<AitudouOutput, "kind">) {
    return node.type === CanvasNodeType.Image && output.kind === "image";
}

export function mergeGeneratedImageHistory(metadata: CanvasNodeMetadata | undefined, output: AitudouOutput, providerTask: AitudouProviderTask, createdAt = new Date().toISOString()) {
    return mergeGeneratedImageOutputsHistory(metadata, [output], providerTask, output, createdAt);
}

export function mergeGeneratedImageOutputsHistory(metadata: CanvasNodeMetadata | undefined, outputs: AitudouOutput[], providerTask: AitudouProviderTask, activeOutput = outputs[0], createdAt = new Date().toISOString()) {
    const history = [...(metadata?.imageHistory || [])];
    const current = imageHistoryEntryFromMetadata(metadata, createdAt);
    if (current) appendOrRefreshHistoryEntry(history, current);

    const generated = outputs.filter((output) => output.kind === "image" && Boolean(output.url || output.sourceUrl)).map((output) => imageHistoryEntryFromOutput(output, providerTask, createdAt));
    generated.forEach((entry) => appendOrRefreshHistoryEntry(history, entry));
    const activeSignature = activeOutput ? imageHistoryEntrySignature(imageHistoryEntryFromOutput(activeOutput, providerTask, createdAt)) : undefined;
    const activeEntry = activeSignature ? history.find((entry) => imageHistoryEntrySignature(entry) === activeSignature) : history.at(-1);

    return {
        imageHistory: history.slice(-MAX_CANVAS_IMAGE_HISTORY),
        activeImageHistoryId: activeEntry?.id,
    };
}

export function imageHistoryMetadataPatch(metadata: CanvasNodeMetadata | undefined, historyId: string): Partial<CanvasNodeMetadata> | null {
    const entry = metadata?.imageHistory?.find((item) => item.id === historyId);
    if (!entry) return null;
    return {
        content: entry.content,
        storageKey: entry.storageKey,
        localPath: entry.localPath,
        filename: entry.filename,
        mimeType: entry.mimeType,
        bytes: entry.bytes,
        naturalWidth: entry.naturalWidth,
        naturalHeight: entry.naturalHeight,
        activeImageHistoryId: entry.id,
    };
}

export function imageHistoryEntrySignature(entry: Pick<CanvasImageHistoryEntry, "content" | "sourceUrl" | "storageKey" | "localPath" | "taskId">) {
    return entry.storageKey || entry.localPath || entry.sourceUrl || entry.taskId || entry.content;
}

function imageHistoryEntryFromMetadata(metadata: CanvasNodeMetadata | undefined, createdAt: string): CanvasImageHistoryEntry | null {
    if (!metadata?.content) return null;
    const signature = metadata.storageKey || metadata.localPath || metadata.content;
    const existing = metadata.imageHistory?.find((entry) => imageHistoryEntrySignature(entry) === signature);
    return {
        id: existing?.id || historyId(signature),
        content: metadata.content,
        sourceUrl: existing?.sourceUrl,
        storageKey: metadata.storageKey,
        localPath: metadata.localPath,
        filename: metadata.filename,
        mimeType: metadata.mimeType,
        bytes: metadata.bytes,
        naturalWidth: metadata.naturalWidth,
        naturalHeight: metadata.naturalHeight,
        taskId: existing?.taskId || metadata.providerResult?.taskId,
        createdAt: existing?.createdAt || createdAt,
    };
}

function imageHistoryEntryFromOutput(output: AitudouOutput, providerTask: AitudouProviderTask, createdAt: string): CanvasImageHistoryEntry {
    const content = output.url || output.sourceUrl || "";
    const signature = output.storageKey || output.localPath || output.sourceUrl || output.taskId || content;
    return {
        id: historyId(signature),
        content,
        sourceUrl: output.sourceUrl,
        storageKey: output.storageKey,
        localPath: output.localPath,
        filename: output.filename,
        mimeType: output.mimeType,
        bytes: output.bytes,
        naturalWidth: output.width,
        naturalHeight: output.height,
        taskId: output.taskId || providerTask.taskId,
        createdAt,
    };
}

function appendOrRefreshHistoryEntry(history: CanvasImageHistoryEntry[], entry: CanvasImageHistoryEntry) {
    const signature = imageHistoryEntrySignature(entry);
    const existingIndex = history.findIndex((item) => imageHistoryEntrySignature(item) === signature);
    if (existingIndex < 0) {
        history.push(entry);
        return;
    }
    history[existingIndex] = { ...history[existingIndex], ...entry, id: history[existingIndex].id, createdAt: history[existingIndex].createdAt };
}

function historyId(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `image-version-${(hash >>> 0).toString(36)}`;
}
