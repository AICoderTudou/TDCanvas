import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type AitudouProviderOutput, type CanvasImageHistoryEntry, type CanvasNodeData } from "@/types/canvas";

export type CanvasProjectCoverMedia = {
    kind: "image" | "video";
    url: string;
    storageKey?: string;
    localPath?: string;
    sourceUrl?: string;
    filename?: string;
    mimeType?: string;
};

export function sortCanvasProjectsByRecent(projects: readonly CanvasProject[]): CanvasProject[] {
    return [...projects].sort((left, right) => safeTimestamp(right.updatedAt) - safeTimestamp(left.updatedAt));
}

export function latestCanvasProjectId(projects: readonly CanvasProject[]): string | undefined {
    return sortCanvasProjectsByRecent(projects)[0]?.id;
}

/** Picks the newest AI-generated visual, independent of the history version currently selected on the canvas. */
export function latestGeneratedCanvasMedia(project: Pick<CanvasProject, "nodes" | "updatedAt">): CanvasProjectCoverMedia | undefined {
    const candidates: Array<CanvasProjectCoverMedia & { timestamp: number; sequence: number }> = [];
    let sequence = 0;

    project.nodes.forEach((node) => {
        const generated = Boolean(node.metadata?.providerTask || node.metadata?.providerResult || node.metadata?.sourceOrigin === "generated");
        if (!generated) return;

        if (node.type === CanvasNodeType.Image) {
            (node.metadata?.imageHistory || []).forEach((entry) => {
                if (!entry.content) return;
                candidates.push({ ...imageHistoryCover(entry), timestamp: safeTimestamp(entry.createdAt), sequence: sequence++ });
            });
        }

        const completedAt = node.metadata?.providerTask?.completedAt || node.metadata?.providerTask?.submittedAt || project.updatedAt;
        (node.metadata?.providerResult?.outputs || []).forEach((output) => {
            const media = providerOutputCover(output);
            if (media) candidates.push({ ...media, timestamp: safeTimestamp(completedAt), sequence: sequence++ });
        });

        // Image history is authoritative: the user may be viewing an older
        // version while the newest generated version should remain the cover.
        if (node.type !== CanvasNodeType.Image || !node.metadata?.imageHistory?.length) {
            const media = nodeCover(node);
            if (media) candidates.push({ ...media, timestamp: safeTimestamp(completedAt), sequence: sequence++ });
        }
    });

    const latest = candidates.sort((left, right) => right.timestamp - left.timestamp || right.sequence - left.sequence)[0];
    if (!latest) return undefined;
    const { timestamp: _timestamp, sequence: _sequence, ...media } = latest;
    return media;
}

function imageHistoryCover(entry: CanvasImageHistoryEntry): CanvasProjectCoverMedia {
    return {
        kind: "image",
        url: entry.content,
        storageKey: entry.storageKey,
        localPath: entry.localPath,
        sourceUrl: entry.sourceUrl,
        filename: entry.filename,
        mimeType: entry.mimeType,
    };
}

function providerOutputCover(output: AitudouProviderOutput): CanvasProjectCoverMedia | undefined {
    if (output.kind !== "image" && output.kind !== "video") return undefined;
    const url = output.url || output.sourceUrl || "";
    if (!url) return undefined;
    return {
        kind: output.kind,
        url,
        storageKey: output.storageKey,
        localPath: output.localPath,
        sourceUrl: output.sourceUrl,
        filename: output.filename || output.name,
        mimeType: output.mimeType,
    };
}

function nodeCover(node: CanvasNodeData): CanvasProjectCoverMedia | undefined {
    if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) return undefined;
    const url = node.metadata?.content || "";
    if (!url) return undefined;
    const output = node.metadata?.providerResult?.outputs?.find((item) => item.kind === node.type);
    return {
        kind: node.type === CanvasNodeType.Image ? "image" : "video",
        url,
        storageKey: node.metadata?.storageKey || output?.storageKey,
        localPath: node.metadata?.localPath || output?.localPath,
        sourceUrl: output?.sourceUrl,
        filename: node.metadata?.filename || output?.filename || output?.name,
        mimeType: node.metadata?.mimeType || output?.mimeType,
    };
}

function safeTimestamp(value: string): number {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}
