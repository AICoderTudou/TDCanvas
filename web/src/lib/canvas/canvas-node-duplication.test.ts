import { describe, expect, it } from "vitest";

import { dragDuplicateNodeIds, duplicateCanvasNodes, duplicateIncomingConnections, expandCanvasNodeIds, incomingConnectionIds } from "./canvas-node-duplication";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const nodes: CanvasNodeData[] = [
    { id: "image", type: CanvasNodeType.Image, title: "参考图", position: { x: 0, y: 0 }, width: 100, height: 100 },
    { id: "workflow", type: "plugin:workflow", title: "工作流", position: { x: 200, y: 0 }, width: 200, height: 160 },
    { id: "result", type: CanvasNodeType.Video, title: "结果", position: { x: 500, y: 0 }, width: 200, height: 160 },
];

const connections: CanvasConnection[] = [
    { id: "input", fromNodeId: "image", toNodeId: "workflow", fromPortId: "image", toPortId: "reference" },
    { id: "output", fromNodeId: "workflow", toNodeId: "result", fromPortId: "video", toPortId: "video" },
];

describe("canvas node duplication", () => {
    it("duplicates a node and reconnects the same upstream input without cloning the source", () => {
        const result = duplicateCanvasNodes(
            nodes,
            connections,
            new Set(["workflow"]),
            { x: 36, y: 36 },
            () => "workflow-copy",
            () => "input-copy",
        );

        expect(result.nodes).toEqual([expect.objectContaining({ id: "workflow-copy", position: { x: 236, y: 36 } })]);
        expect(result.connections).toEqual([{ id: "input-copy", fromNodeId: "image", toNodeId: "workflow-copy", fromPortId: "image", toPortId: "reference" }]);
    });

    it("remaps internal sources while preserving external incoming sources", () => {
        const idMap = new Map([
            ["workflow", "workflow-copy"],
            ["result", "result-copy"],
        ]);
        const copied = duplicateIncomingConnections(connections, idMap, new Set(nodes.map((node) => node.id)), (_connection, index) => `copy-${index}`);

        expect(copied).toEqual([
            { id: "copy-0", fromNodeId: "image", toNodeId: "workflow-copy", fromPortId: "image", toPortId: "reference" },
            { id: "copy-1", fromNodeId: "workflow-copy", toNodeId: "result-copy", fromPortId: "video", toPortId: "video" },
        ]);
    });

    it("returns only connections entering the requested node", () => {
        expect(incomingConnectionIds(connections, "workflow")).toEqual(["input"]);
    });

    it("limits Alt-drag duplication to the clicked module", () => {
        expect([...dragDuplicateNodeIds("workflow", new Set(["image", "workflow"]), true)]).toEqual(["workflow"]);
        expect([...dragDuplicateNodeIds("workflow", new Set(["image", "workflow"]), false)]).toEqual(["image", "workflow"]);
    });

    it("expands only the clicked structure and remaps batch relationships", () => {
        const structured: CanvasNodeData[] = [
            { ...nodes[0]!, id: "unrelated-group", type: CanvasNodeType.Group, metadata: {} },
            { ...nodes[0]!, id: "unrelated-child", metadata: { groupId: "unrelated-group" } },
            { ...nodes[1]!, id: "batch", metadata: { batchChildIds: ["batch-child"] } },
            { ...nodes[2]!, id: "batch-child", metadata: { batchRootId: "batch" } },
        ];
        const expanded = expandCanvasNodeIds(structured, dragDuplicateNodeIds("batch", new Set(["unrelated-group", "batch"]), true));
        const duplicated = duplicateCanvasNodes(
            structured,
            [],
            expanded,
            { x: 0, y: 0 },
            (node) => `${node.id}-copy`,
            () => "connection-copy",
        );

        expect([...expanded]).toEqual(["batch", "batch-child"]);
        expect(duplicated.nodes.find((node) => node.id === "batch-copy")?.metadata?.batchChildIds).toEqual(["batch-child-copy"]);
        expect(duplicated.nodes.find((node) => node.id === "batch-child-copy")?.metadata?.batchRootId).toBe("batch-copy");
    });
});
