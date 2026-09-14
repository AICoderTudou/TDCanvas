import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    definition: null as import("./index").ComfyWorkflowDefinition | null,
    status: vi.fn(),
    queueWorkflow: vi.fn(),
    waitForExecution: vi.fn(),
    uploadInput: vi.fn(),
    interruptExecution: vi.fn(),
    resolveDownloadBlob: vi.fn(),
    materializeWorkflow: vi.fn((definition: import("./index").ComfyWorkflowDefinition) => structuredClone(definition.apiWorkflow)),
}));

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/platform/desktop-runtime", () => ({ desktopFileUrl: (path: string) => `desktop://${path}`, invokeDesktop: vi.fn() }));
vi.mock("@/services/media-download", () => ({ resolveDownloadBlob: mocks.resolveDownloadBlob }));
vi.mock("./workflow-library", () => ({ getComfyWorkflowDefinition: vi.fn(async () => mocks.definition) }));
vi.mock("./index", () => ({
    comfyNativeClient: mocks,
    materializeComfyWorkflow: mocks.materializeWorkflow,
}));

import { createComfyWorkflowCanvasNode } from "./canvas-node";
import { readComfyResultBinding } from "./result-nodes";
import { runComfyWorkflowNode } from "./execution";
import type { ComfyWorkflowDefinition } from "./index";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

const definition: ComfyWorkflowDefinition = {
    id: "workflow-1",
    name: "本地成片",
    environmentId: "environment-1",
    apiWorkflow: { "9": { class_type: "SaveImage", inputs: {} } },
    workflowHash: "hash",
    inputs: [],
    outputs: [{ id: "9:result", nodeId: "9", resultField: "images", label: "图片", resourceType: "image", canvasPort: false, preview: true }],
    dependencySnapshot: { nodeCount: 1, classTypes: ["SaveImage"], customNodeCount: 0, missingClassTypes: [], runnable: true, verifiedAt: "2026-08-30T00:00:00.000Z" },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
};

describe("ComfyUI canvas execution", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.definition = definition;
        mocks.status.mockResolvedValue({ phase: "running", profileId: definition.environmentId });
        mocks.queueWorkflow.mockResolvedValue({ promptId: "prompt-1" });
        mocks.uploadInput.mockResolvedValue({ name: "global-source.png", subfolder: "" });
        mocks.resolveDownloadBlob.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
        mocks.waitForExecution.mockResolvedValue({
            promptId: "prompt-1",
            completedAt: 1234,
            outputs: [{ outputId: "9:result", nodeId: "9", itemIndex: 0, resourceType: "image", label: "图片", absolutePath: "C:\\cache\\result.png", filename: "result.png", mimeType: "image/png", bytes: 42 }],
        });
    });

    it("keeps three independent video results after three sequential runs", async () => {
        const videoDefinition: ComfyWorkflowDefinition = {
            ...definition,
            outputs: [{ id: "9:result", nodeId: "9", resultField: "videos", label: "视频", resourceType: "video", canvasPort: true, preview: true }],
        };
        mocks.definition = videoDefinition;
        mocks.queueWorkflow.mockReset().mockResolvedValueOnce({ promptId: "prompt-1" }).mockResolvedValueOnce({ promptId: "prompt-2" }).mockResolvedValueOnce({ promptId: "prompt-3" });
        mocks.waitForExecution
            .mockReset()
            .mockResolvedValueOnce({ promptId: "prompt-1", completedAt: 1001, outputs: [{ outputId: "9:result", nodeId: "9", itemIndex: 0, resourceType: "video", label: "视频", absolutePath: "C:\\cache\\first.mp4", filename: "first.mp4", mimeType: "video/mp4", bytes: 101 }] })
            .mockResolvedValueOnce({ promptId: "prompt-2", completedAt: 1002, outputs: [{ outputId: "9:result", nodeId: "9", itemIndex: 0, resourceType: "video", label: "视频", absolutePath: "C:\\cache\\second.mp4", filename: "second.mp4", mimeType: "video/mp4", bytes: 102 }] })
            .mockResolvedValueOnce({ promptId: "prompt-3", completedAt: 1003, outputs: [{ outputId: "9:result", nodeId: "9", itemIndex: 0, resourceType: "video", label: "视频", absolutePath: "C:\\cache\\third.mp4", filename: "third.mp4", mimeType: "video/mp4", bytes: 103 }] });
        const source = createComfyWorkflowCanvasNode(videoDefinition, { x: 400, y: 300 });
        const nodes: CanvasNodeData[] = [source];
        const connections: CanvasConnection[] = [];
        const ctx = createContext(source, nodes, connections);

        await runComfyWorkflowNode(ctx);
        const first = nodes.find((node) => readComfyResultBinding(node)?.sourceNodeId === source.id)!;
        const firstMetadata = structuredClone(first.metadata);
        await runComfyWorkflowNode(ctx);
        await runComfyWorkflowNode(ctx);

        const results = nodes.filter((node) => readComfyResultBinding(node)?.sourceNodeId === source.id);
        expect(results).toHaveLength(3);
        expect(connections).toHaveLength(3);
        expect(results.map((node) => node.metadata?.localPath)).toEqual(["C:\\cache\\first.mp4", "C:\\cache\\second.mp4", "C:\\cache\\third.mp4"]);
        expect(results.map((node) => node.metadata?.comfyuiPromptId)).toEqual(["prompt-1", "prompt-2", "prompt-3"]);
        expect(nodes.find((node) => node.id === first.id)?.metadata).toEqual(firstMetadata);
        expect(nodes.find((node) => node.id === source.id)?.metadata).toMatchObject({ status: "success", comfyuiRun: { phase: "succeeded", promptId: "prompt-3" } });
    });

    it("gets a generated result from the current canvas without a connection", async () => {
        const workflowWithImageInput: ComfyWorkflowDefinition = {
            ...definition,
            apiWorkflow: {
                "4": { class_type: "LoadImage", inputs: { image: "" } },
                ...definition.apiWorkflow,
            },
            inputs: [
                {
                    id: "4:image",
                    nodeId: "4",
                    field: "image",
                    label: "参考图",
                    valueType: "image",
                    control: "media",
                    defaultValue: "",
                    required: true,
                    canvasPort: true,
                },
            ],
        };
        mocks.definition = workflowWithImageInput;
        const source = createComfyWorkflowCanvasNode(workflowWithImageInput, { x: 400, y: 300 });
        const generatedResult: CanvasNodeData = {
            id: "generated-image",
            type: CanvasNodeType.Image,
            title: "角色参考图",
            position: { x: 40, y: 40 },
            width: 640,
            height: 360,
            metadata: {
                content: "blob:global-generated-image",
                filename: "角色参考图.png",
                mimeType: "image/png",
                sourceOrigin: "generated",
                canvasSetEnabled: true,
                status: "success",
            },
        };
        source.metadata = {
            ...source.metadata,
            objectReferences: [{ id: "global-get-1", sourceNodeId: generatedResult.id, targetInputId: "4:image", versionMode: "latest" }],
        };
        const nodes = [source, generatedResult];
        const connections: CanvasConnection[] = [];

        await runComfyWorkflowNode(createContext(source, nodes, connections));

        expect(connections).toHaveLength(1);
        expect(connections[0]).toMatchObject({ fromNodeId: source.id, toNodeId: expect.any(String) });
        expect(mocks.resolveDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({ kind: "image", url: "blob:global-generated-image" }));
        expect(mocks.uploadInput).toHaveBeenCalledWith(workflowWithImageInput.environmentId, "角色参考图.png", "image/png", [1, 2, 3]);
        expect(mocks.materializeWorkflow).toHaveBeenCalledWith(workflowWithImageInput, expect.any(Object), { "4:image": "global-source.png" }, new Set());
    });
});

function createContext(source: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeContext {
    const applyOps = (ops: CanvasAgentOp[]) => {
        for (const op of ops) {
            if (op.type === "add_node") {
                nodes.push({ id: op.id!, type: op.nodeType!, title: op.title!, position: op.position!, width: op.width!, height: op.height!, metadata: op.metadata });
            } else if (op.type === "update_node") {
                const index = nodes.findIndex((node) => node.id === op.id);
                if (index >= 0) nodes[index] = { ...nodes[index]!, ...op.patch, metadata: { ...nodes[index]!.metadata, ...op.patch?.metadata, ...op.metadata } };
            } else if (op.type === "connect_nodes" && !connections.some((connection) => connection.fromNodeId === op.fromNodeId && connection.toNodeId === op.toNodeId && connection.fromPortId === op.fromPortId)) {
                connections.push({ id: op.id || `connection-${connections.length}`, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId, fromPortId: op.fromPortId, toPortId: op.toPortId });
            }
        }
    };
    return {
        canvasTitle: "测试画布",
        node: source,
        theme: {} as CanvasNodeContext["theme"],
        scale: 1,
        isSelected: true,
        updateMetadata: () => undefined,
        updateNode: () => undefined,
        getNode: (id) => nodes.find((node) => node.id === id) || null,
        getNodes: () => nodes,
        getConnections: () => connections,
        getInputConnections: (portId) => connections.filter((connection) => connection.toNodeId === source.id && (!portId || connection.toPortId === portId)),
        getOutputConnections: (portId) => connections.filter((connection) => connection.fromNodeId === source.id && (!portId || connection.fromPortId === portId)),
        getUpstream: () => [],
        getDownstream: () => [],
        applyOps,
        emit: () => undefined,
        on: () => () => undefined,
        ai: {} as CanvasNodeContext["ai"],
        openPanel: () => undefined,
        closePanel: () => undefined,
        storage: {} as CanvasNodeContext["storage"],
    };
}
