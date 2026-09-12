import { nanoid } from "nanoid";

import type { ComfyExposedOutput, ComfyWorkflowDefinition } from "./index";
import { getNodeSpec } from "@/constant/canvas";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

export type ComfyResultBinding = {
    sourceNodeId: string;
    workflowId: string;
    outputId: string;
    resourceType: ComfyExposedOutput["resourceType"];
    itemIndex: number;
};

export function createComfyResultNodes(source: CanvasNodeData, definition: ComfyWorkflowDefinition) {
    const nodes = definition.outputs.map((output, index) => createComfyResultNode(source, definition, output, index, 0));
    const connections = nodes.map(
        (node, index): CanvasConnection => ({
            id: nanoid(),
            fromNodeId: source.id,
            toNodeId: node.id,
            fromPortId: definition.outputs[index]?.id,
        }),
    );
    return { nodes, connections };
}

export function createComfyResultNode(source: CanvasNodeData, definition: ComfyWorkflowDefinition, output: ComfyExposedOutput, outputIndex: number, itemIndex: number) {
    const type = comfyResultNodeType(output.resourceType);
    const center = resultNodeCenter(source, type, outputIndex, itemIndex);
    const binding: ComfyResultBinding = { sourceNodeId: source.id, workflowId: definition.id, outputId: output.id, resourceType: output.resourceType, itemIndex };
    const node = createCanvasNode(type, center, {
        status: "idle",
        content: "",
        sourceOrigin: "generated",
        generationMode: output.resourceType === "image" || output.resourceType === "video" || output.resourceType === "audio" || output.resourceType === "text" ? output.resourceType : "text",
        comfyuiResult: binding,
    });
    return { ...node, title: resultNodeTitle(definition, output, itemIndex) };
}

export function ensureComfyResultNodeOps(source: CanvasNodeData, definition: ComfyWorkflowDefinition, nodes: CanvasNodeData[], connections: CanvasConnection[], itemIndexes: Record<string, number[]> = {}): CanvasAgentOp[] {
    const ops: CanvasAgentOp[] = [];
    definition.outputs.forEach((output, outputIndex) => {
        const indexes = itemIndexes[output.id]?.length ? itemIndexes[output.id]! : [0];
        indexes.forEach((itemIndex) => {
            let result = nodes.find((node) => {
                const binding = readComfyResultBinding(node);
                return binding?.sourceNodeId === source.id && binding.outputId === output.id && binding.itemIndex === itemIndex;
            });
            if (!result) {
                result = createComfyResultNode(source, definition, output, outputIndex, itemIndex);
                ops.push({ type: "add_node", id: result.id, nodeType: result.type, title: result.title, position: result.position, width: result.width, height: result.height, metadata: result.metadata });
                nodes = [...nodes, result];
            }
            const connected = connections.some((connection) => connection.fromNodeId === source.id && connection.toNodeId === result!.id && connection.fromPortId === output.id);
            if (!connected) {
                const connection = { id: nanoid(), fromNodeId: source.id, toNodeId: result.id, fromPortId: output.id };
                ops.push({ type: "connect_nodes", ...connection });
                connections = [...connections, connection];
            }
        });
    });
    return ops;
}

export function replaceComfyResultNodeOps(source: CanvasNodeData, definition: ComfyWorkflowDefinition, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const staleIds = new Set(nodes.filter((node) => readComfyResultBinding(node)?.sourceNodeId === source.id).map((node) => node.id));
    const cleanNodes = nodes.filter((node) => !staleIds.has(node.id));
    const cleanConnections = connections.filter((connection) => !staleIds.has(connection.fromNodeId) && !staleIds.has(connection.toNodeId));
    return [...(staleIds.size ? ([{ type: "delete_node", ids: [...staleIds] }] as CanvasAgentOp[]) : []), ...ensureComfyResultNodeOps(source, definition, cleanNodes, cleanConnections)];
}

export function readComfyResultBinding(node: CanvasNodeData): ComfyResultBinding | null {
    const value = node.metadata?.comfyuiResult;
    if (!value || typeof value !== "object") return null;
    const binding = value as Partial<ComfyResultBinding>;
    return binding.sourceNodeId && binding.workflowId && binding.outputId && binding.resourceType && typeof binding.itemIndex === "number" ? (binding as ComfyResultBinding) : null;
}

export function comfyResultNodeType(resourceType: ComfyExposedOutput["resourceType"]) {
    if (resourceType === "image") return CanvasNodeType.Image;
    if (resourceType === "video") return CanvasNodeType.Video;
    if (resourceType === "audio") return CanvasNodeType.Audio;
    return CanvasNodeType.Text;
}

function resultNodeCenter(source: CanvasNodeData, type: CanvasNodeType, outputIndex: number, itemIndex: number): Position {
    const { width, height } = getNodeSpec(type);
    const row = outputIndex + itemIndex;
    return {
        x: source.position.x + source.width + 120 + width / 2,
        y: source.position.y + row * (height + 56) + height / 2,
    };
}

function resultNodeTitle(definition: ComfyWorkflowDefinition, output: ComfyExposedOutput, itemIndex: number) {
    const suffix = itemIndex ? ` ${itemIndex + 1}` : "";
    return `${definition.name} · ${output.label}${suffix}`;
}
