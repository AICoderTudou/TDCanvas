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

        const ops = ensureComfyResultNodeOps(source, definition, [...graph.nodes], [...graph.connections], { "10:result": [0, 1] });
        expect(ops.filter((op) => op.type === "add_node")).toHaveLength(1);
        expect(ops.filter((op) => op.type === "connect_nodes")).toHaveLength(1);
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
