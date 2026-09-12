import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodePort } from "@/types/canvas";

import { areCanvasPortTypesCompatible, getCanvasNodePorts, getConnectionHandleAnchor, normalizeConnectionHandles } from "./canvas-node-ports";

const pluginId = "ports-test";
const sourceType = `${pluginId}:source`;
const targetType = `${pluginId}:target`;

afterEach(() => unregisterPluginNodes(pluginId));

describe("canvas named ports", () => {
    it("preserves legacy handles and center anchors for existing nodes", () => {
        const image = node("image", CanvasNodeType.Image);
        const config = node("config", CanvasNodeType.Config);

        expect(getCanvasNodePorts(image).map(({ direction, legacy }) => ({ direction, legacy }))).toEqual([
            { direction: "input", legacy: true },
            { direction: "output", legacy: true },
        ]);
        expect(getCanvasNodePorts(config).map((port) => port.direction)).toEqual(["input"]);
        expect(getConnectionHandleAnchor(image, { handleType: "source" })).toEqual({ x: 340, y: 140 });
        expect(getConnectionHandleAnchor(image, { handleType: "target" })).toEqual({ x: 20, y: 140 });
    });

    it("resolves stable dynamic ports, removes duplicates, and positions them by order", () => {
        registerPorts([
            port("prompt", "提示词", "input", "text"),
            port("image", "参考图", "input", "image"),
            port("image", "重复参考图", "input", "image"),
            port("result", "结果", "output", "image"),
            { id: "broken", label: "损坏端口", direction: "output" } as CanvasNodePort,
        ]);
        const target = node("target", targetType);

        expect(getCanvasNodePorts(target).map((item) => item.id)).toEqual(["prompt", "image", "result"]);
        expect(getConnectionHandleAnchor(target, { handleType: "target", portId: "prompt" })).toEqual({ x: 20, y: 100 });
        expect(getConnectionHandleAnchor(target, { handleType: "target", portId: "image" })).toEqual({ x: 20, y: 180 });
        expect(getConnectionHandleAnchor(target, { handleType: "source", portId: "result" })).toEqual({ x: 340, y: 140 });
        expect(getConnectionHandleAnchor(target, { handleType: "target", portId: "removed-port" })).toBeNull();
    });

    it("normalizes reverse drags, stores port ids, and rejects incompatible or occupied inputs", () => {
        registerDefinitions();
        const source = node("source", sourceType);
        const target = node("target", targetType);
        const nodes = [source, target];

        const normalized = normalizeConnectionHandles({ nodeId: target.id, handleType: "target", portId: "image" }, { nodeId: source.id, handleType: "source", portId: "image" }, nodes);
        expect(normalized).toEqual({ fromNodeId: source.id, toNodeId: target.id, fromPortId: "image", toPortId: "image" });

        expect(normalizeConnectionHandles({ nodeId: source.id, handleType: "source", portId: "text" }, { nodeId: target.id, handleType: "target", portId: "image" }, nodes)).toBeNull();
        expect(normalizeConnectionHandles({ nodeId: source.id, handleType: "source" }, { nodeId: target.id, handleType: "target" }, nodes)).toBeNull();

        const occupied: CanvasConnection[] = [{ id: "existing", fromNodeId: source.id, toNodeId: target.id, fromPortId: "image", toPortId: "image" }];
        expect(normalizeConnectionHandles({ nodeId: source.id, handleType: "source", portId: "image" }, { nodeId: target.id, handleType: "target", portId: "image" }, nodes, occupied)).toBeNull();
        expect(normalizeConnectionHandles({ nodeId: source.id, handleType: "source", portId: "text" }, { nodeId: target.id, handleType: "target", portId: "prompt" }, nodes, occupied)).toMatchObject({ fromPortId: "text", toPortId: "prompt" });
    });

    it("supports any and case-insensitive custom ComfyUI types", () => {
        expect(areCanvasPortTypesCompatible(port("a", "A", "output", "LATENT"), port("b", "B", "input", "latent"))).toBe(true);
        expect(areCanvasPortTypesCompatible(port("a", "A", "output", "IMAGE"), port("b", "B", "input", "any"))).toBe(true);
        expect(areCanvasPortTypesCompatible(port("a", "A", "output", "IMAGE"), port("b", "B", "input", "MASK"))).toBe(false);
        expect(areCanvasPortTypesCompatible({ id: "broken", label: "Broken", direction: "output" } as CanvasNodePort, port("b", "B", "input", "any"))).toBe(false);
    });
});

function registerPorts(ports: CanvasNodePort[]) {
    registerNodeDefinitions([{ type: targetType, title: "目标", icon: null, defaultSize: { width: 320, height: 240 }, ports }], pluginId);
}

function registerDefinitions() {
    registerNodeDefinitions(
        [
            { type: sourceType, title: "源", icon: null, defaultSize: { width: 320, height: 240 }, ports: [port("image", "图像", "output", "image"), port("text", "文本", "output", "text")] },
            { type: targetType, title: "目标", icon: null, defaultSize: { width: 320, height: 240 }, ports: [port("image", "图像", "input", "image"), port("prompt", "提示词", "input", "text")] },
        ],
        pluginId,
    );
}

function port(id: string, label: string, direction: CanvasNodePort["direction"], dataType: string): CanvasNodePort {
    return { id, label, direction, dataType };
}

function node(id: string, type: string): CanvasNodeData {
    return { id, type, title: id, position: { x: 20, y: 20 }, width: 320, height: 240, metadata: {} };
}
