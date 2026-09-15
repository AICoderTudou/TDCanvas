import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import type { ComfyWorkflowDefinition } from "./index";
import { createComfyResultNodes, ensureComfyResultNodeOps, readComfyResultBinding, replaceComfyResultNodeOps } from "./result-nodes";
import { COMFY_WORKFLOW_NODE_TYPE, createComfyWorkflowCanvasNode } from "./canvas-node";
import { CanvasNodeType } from "@/types/canvas";

const definition: ComfyWorkflowDefinition = {
    id: "workflow-1",
    name: "产品短片",
    environmentId: "environment-1",
    apiWorkflow: {},
    workflowHash: "hash",
    inputs: [],
    outputs: [
        { id: "10:result", nodeId: "10", label: "封面", resourceType: "image", canvasPort: false, preview: true, resultField: "images" },
        { id: "11:result", nodeId: "11", label: "成片", resourceType: "video", canvasPort: true, preview: true, resultField: "videos" },
        { id: "12:result", nodeId: "12", label: "配音", resourceType: "audio", canvasPort: true, preview: true, resultField: "audio" },
        { id: "13:result", nodeId: "13", label: "描述", resourceType: "text", canvasPort: false, preview: true, resultField: "text" },
    ],
    dependencySnapshot: { nodeCount: 4, classTypes: [], customNodeCount: 0, missingClassTypes: [], runnable: true, verifiedAt: "2026-08-30T00:00:00.000Z" },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
};

describe("ComfyUI managed result nodes", () => {
    it("creates one native result node and one connection for every workflow output", () => {
        const source = createComfyWorkflowCanvasNode(definition, { x: 400, y: 300 });
        const graph = createComfyResultNodes(source, definition);

        expect(source.type).toBe(COMFY_WORKFLOW_NODE_TYPE);
        expect(graph.nodes.map((node) => node.type)).toEqual([CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text]);
        expect(graph.connections).toHaveLength(4);
        expect(graph.connections.map((connection) => connection.fromPortId)).toEqual(definition.outputs.map((output) => output.id));
        expect(readComfyResultBinding(graph.nodes[0]!)).toMatchObject({ sourceNodeId: source.id, outputId: "10:result", resourceType: "image", itemIndex: 0 });
    });

    it("reuses existing result nodes and only adds new items returned by a batch output", () => {
        const source = createComfyWorkflowCanvasNode(definition, { x: 400, y: 300 });
        const graph = createComfyResultNodes(source, definition);

        expect(ensureComfyResultNodeOps(source, definition, [...graph.nodes], [...graph.connections])).toEqual([]);

        const ops = ensureComfyResultNodeOps(source, definition, [...graph.nodes], [...graph.connections], { itemIndexes: { "10:result": [0, 1] } });
        expect(ops.filter((op) => op.type === "add_node")).toHaveLength(1);
        expect(ops.filter((op) => op.type === "connect_nodes")).toHaveLength(1);
    });

    it("adds a result node and connection for a new workflow run", () => {
        const videoDefinition = { ...definition, outputs: [definition.outputs[1]!] };
        const source = createComfyWorkflowCanvasNode(videoDefinition, { x: 400, y: 300 });
        const graph = createComfyResultNodes(source, videoDefinition);
        const completed = {
            ...graph.nodes[0]!,
            metadata: { ...graph.nodes[0]!.metadata, status: "success" as const, content: "desktop://first.mp4", localPath: "C:\\cache\\first.mp4", comfyuiPromptId: "prompt-1" },
        };

        const ops = ensureComfyResultNodeOps(source, videoDefinition, [source, completed], graph.connections, {
            promptId: "prompt-2",
            itemIndexes: { "11:result": [0] },
        });

        expect(ops.filter((op) => op.type === "add_node")).toHaveLength(1);
        expect(ops.filter((op) => op.type === "connect_nodes")).toHaveLength(1);
    });

    it("preserves a non-empty legacy result without a prompt id", () => {
        const videoDefinition = { ...definition, outputs: [definition.outputs[1]!] };
        const source = createComfyWorkflowCanvasNode(videoDefinition, { x: 400, y: 300 });
        const graph = createComfyResultNodes(source, videoDefinition);
        const legacy = { ...graph.nodes[0]!, metadata: { ...graph.nodes[0]!.metadata, status: "success" as const, content: "desktop://legacy.mp4", localPath: "C:\\cache\\legacy.mp4" } };

        const ops = ensureComfyResultNodeOps(source, videoDefinition, [source, legacy], graph.connections, { promptId: "prompt-2" });

        expect(ops.filter((op) => op.type === "add_node")).toHaveLength(1);
        expect(ops.some((op) => op.type === "update_node" && op.id === legacy.id)).toBe(false);
    });

    it("creates a fresh result after a historical result was deleted", () => {
        const videoDefinition = { ...definition, outputs: [definition.outputs[1]!] };
        const source = createComfyWorkflowCanvasNode(videoDefinition, { x: 400, y: 300 });

        const ops = ensureComfyResultNodeOps(source, videoDefinition, [source], [], { promptId: "prompt-2" });

        expect(ops.filter((op) => op.type === "add_node")).toHaveLength(1);
        expect(ops.filter((op) => op.type === "connect_nodes")).toHaveLength(1);
    });

    it("does not duplicate results while reconciling the same prompt id", () => {
        const videoDefinition = { ...definition, outputs: [definition.outputs[1]!] };
        const source = createComfyWorkflowCanvasNode(videoDefinition, { x: 400, y: 300 });
        const graph = createComfyResultNodes(source, videoDefinition);
        const claimed = { ...graph.nodes[0]!, metadata: { ...graph.nodes[0]!.metadata, comfyuiPromptId: "prompt-1" } };

        expect(ensureComfyResultNodeOps(source, videoDefinition, [source, claimed], graph.connections, { promptId: "prompt-1" })).toEqual([]);
    });

    it("appends multiple outputs and batch items below existing results without overlap", () => {
        const source = createComfyWorkflowCanvasNode(definition, { x: 400, y: 300 });
        const graph = createComfyResultNodes(source, definition);
        const completed = graph.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, status: "success" as const, content: `desktop://${node.id}`, comfyuiPromptId: "prompt-1" } }));

        const ops = ensureComfyResultNodeOps(source, definition, [source, ...completed], graph.connections, {
            promptId: "prompt-2",
            itemIndexes: { "10:result": [0, 1], "11:result": [0], "12:result": [0], "13:result": [0] },
        });
        const added = ops.filter((op) => op.type === "add_node").map((op) => ({ position: op.position!, height: op.height! }));
        const previousBottom = Math.max(...completed.map((node) => node.position.y + node.height));

        expect(added).toHaveLength(5);
        expect(added[0]!.position.y).toBeGreaterThanOrEqual(previousBottom + 56);
        for (let index = 1; index < added.length; index += 1) {
            expect(added[index]!.position.y).toBeGreaterThanOrEqual(added[index - 1]!.position.y + added[index - 1]!.height + 56);
        }
    });

    it("removes stale managed results before binding a different workflow", () => {
        const source = createComfyWorkflowCanvasNode(definition, { x: 400, y: 300 });
        const graph = createComfyResultNodes(source, definition);
        const replacement = { ...definition, id: "workflow-2", name: "另一个工作流", outputs: definition.outputs.slice(0, 1) };

        const ops = replaceComfyResultNodeOps(source, replacement, [source, ...graph.nodes], graph.connections);
        expect(ops[0]).toMatchObject({ type: "delete_node", ids: graph.nodes.map((node) => node.id) });
        expect(ops.filter((op) => op.type === "add_node")).toHaveLength(1);
        expect(ops.filter((op) => op.type === "connect_nodes")).toHaveLength(1);
    });
});
