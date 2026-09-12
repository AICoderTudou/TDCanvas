import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { LAST_USED_NODE_CONFIG_KEY, readLastUsedNodeConfig, rememberLastUsedNodeConfig } from "./canvas-node-preferences";

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) || null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        values,
    };
}

function node(type: CanvasNodeType, payload: Record<string, unknown>): CanvasNodeData {
    return {
        id: `${type}-1`,
        type,
        title: type,
        position: { x: 0, y: 0 },
        width: 640,
        height: 420,
        metadata: {
            aitudouOperation: `${type}.generate`,
            aitudouPayload: JSON.stringify(payload),
            model: String(payload.model || ""),
            prompt: "不会带入新节点",
            status: "success",
            content: "https://example.com/result.png",
        },
    };
}

describe("canvas node last-used configuration", () => {
    it("remembers configuration by node kind and clears the prompt", () => {
        const storage = memoryStorage();
        rememberLastUsedNodeConfig(node(CanvasNodeType.Image, { model: "seedream-v5-pro-t2i", prompt: "old prompt" }), storage);
        rememberLastUsedNodeConfig(node(CanvasNodeType.Video, { model: "seedance-2.0-standard-t2v", prompt: "old video", seconds: "8" }), storage);

        const image = readLastUsedNodeConfig(CanvasNodeType.Image, storage);
        const video = readLastUsedNodeConfig(CanvasNodeType.Video, storage);
        expect(JSON.parse(image?.aitudouPayload || "{}")).toMatchObject({ model: "seedream-v5-pro-t2i", prompt: "" });
        expect(JSON.parse(video?.aitudouPayload || "{}")).toMatchObject({ model: "seedance-2.0-standard-t2v", prompt: "", seconds: "8" });
        expect(image?.content).toBeUndefined();
        expect(image?.status).toBeUndefined();
    });

    it("does not reuse uploaded material metadata", () => {
        const storage = memoryStorage();
        const uploaded = node(CanvasNodeType.Image, { model: "seedream-v4.5" });
        uploaded.metadata = { ...uploaded.metadata, sourceOrigin: "upload" };
        rememberLastUsedNodeConfig(uploaded, storage);
        expect(storage.values.has(LAST_USED_NODE_CONFIG_KEY)).toBe(false);
    });
});
