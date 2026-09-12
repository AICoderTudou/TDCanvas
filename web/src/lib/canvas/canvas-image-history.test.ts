import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { AitudouOutput } from "@/services/api/aitudou-protocol";

import { imageHistoryMetadataPatch, mergeGeneratedImageHistory, mergeGeneratedImageOutputsHistory, shouldKeepGeneratedOutputInImageHistory, shouldReplaceImageNodeOnGeneration } from "./canvas-image-history";

const providerTask = { provider: "aitudou" as const, taskId: "task-new", family: "image" as const };

function imageNode(content = "local-old.png"): CanvasNodeData {
    return {
        id: "image-node",
        type: CanvasNodeType.Image,
        title: "图片",
        position: { x: 0, y: 0 },
        width: 620,
        height: 350,
        metadata: { content, storageKey: "image:old", mimeType: "image/png", naturalWidth: 1200, naturalHeight: 800 },
    };
}

function generatedOutput(url = "local-new.png"): AitudouOutput {
    return {
        kind: "image",
        url,
        sourceUrl: "https://cdn.example.com/new.png",
        storageKey: "image:new",
        mimeType: "image/png",
        width: 1024,
        height: 1024,
        taskId: "task-new",
    };
}

describe("canvas image version history", () => {
    it("keeps the previous image and selects the latest generated image", () => {
        const merged = mergeGeneratedImageHistory(imageNode().metadata, generatedOutput(), providerTask, "2026-08-23T00:00:00.000Z");

        expect(merged.imageHistory).toHaveLength(2);
        expect(merged.imageHistory.map((entry) => entry.storageKey)).toEqual(["image:old", "image:new"]);
        expect(merged.activeImageHistoryId).toBe(merged.imageHistory[1].id);
    });

    it("does not duplicate the same completed result when polling is resumed", () => {
        const first = mergeGeneratedImageHistory(imageNode().metadata, generatedOutput(), providerTask, "2026-08-23T00:00:00.000Z");
        const metadata: CanvasNodeMetadata = {
            ...imageNode("local-new.png").metadata,
            storageKey: "image:new",
            imageHistory: first.imageHistory,
            activeImageHistoryId: first.activeImageHistoryId,
        };
        const resumed = mergeGeneratedImageHistory(metadata, generatedOutput(), providerTask, "2026-08-23T00:01:00.000Z");

        expect(resumed.imageHistory).toHaveLength(2);
        expect(resumed.activeImageHistoryId).toBe(first.activeImageHistoryId);
    });

    it("keeps every image from a multi-output run inside the same node history", () => {
        const first = generatedOutput("local-new-1.png");
        const second = { ...generatedOutput("local-new-2.png"), sourceUrl: "https://cdn.example.com/new-2.png", storageKey: "image:new-2" };
        const merged = mergeGeneratedImageOutputsHistory(imageNode().metadata, [first, second], providerTask, first, "2026-08-23T00:00:00.000Z");

        expect(merged.imageHistory.map((entry) => entry.storageKey)).toEqual(["image:old", "image:new", "image:new-2"]);
        expect(merged.activeImageHistoryId).toBe(merged.imageHistory[1].id);
    });

    it("restores all cached media fields when the user switches versions", () => {
        const merged = mergeGeneratedImageHistory(imageNode().metadata, generatedOutput(), providerTask, "2026-08-23T00:00:00.000Z");
        const oldVersion = merged.imageHistory[0];
        const patch = imageHistoryMetadataPatch({ ...imageNode().metadata, ...merged }, oldVersion.id);

        expect(patch).toMatchObject({
            content: "local-old.png",
            storageKey: "image:old",
            mimeType: "image/png",
            naturalWidth: 1200,
            naturalHeight: 800,
            activeImageHistoryId: oldVersion.id,
        });
    });

    it("reuses an existing image node even when it already has content", () => {
        expect(shouldReplaceImageNodeOnGeneration(imageNode())).toBe(true);
        expect(shouldReplaceImageNodeOnGeneration({ ...imageNode(), type: CanvasNodeType.Video })).toBe(false);
        expect(shouldKeepGeneratedOutputInImageHistory(imageNode(), { kind: "image" })).toBe(true);
        expect(shouldKeepGeneratedOutputInImageHistory(imageNode(), { kind: "video" })).toBe(false);
    });
});
