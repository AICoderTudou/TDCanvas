import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

export function duplicateCanvasNodes(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    nodeIds: ReadonlySet<string>,
    offset: Position,
    createNodeId: (node: CanvasNodeData, index: number) => string,
    createConnectionId: (connection: CanvasConnection, index: number) => string,
) {
    const duplicated = duplicateNodeData(
        nodes.filter((node) => nodeIds.has(node.id)),
        offset,
        createNodeId,
    );
    return {
        nodes: duplicated.nodes,
        connections: duplicateIncomingConnections(connections, duplicated.idMap, new Set(nodes.map((node) => node.id)), createConnectionId),
        idMap: duplicated.idMap,
    };
}

export function duplicateNodeData(nodes: CanvasNodeData[], offset: Position, createNodeId: (node: CanvasNodeData, index: number) => string) {
    const idMap = new Map<string, string>();
    const copies = nodes.map((node, index) => {
        const id = createNodeId(node, index);
        idMap.set(node.id, id);
        return {
            ...node,
            id,
            title: node.title.endsWith(" 副本") ? node.title : `${node.title} 副本`,
            position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
            metadata: node.metadata ? { ...node.metadata } : undefined,
        };
    });
    const remapped = copies.map((node) => ({ ...node, metadata: remapDuplicatedMetadata(node.metadata, idMap) }));
    return { nodes: remapped, idMap };
}

export function duplicateIncomingConnections(connections: CanvasConnection[], idMap: ReadonlyMap<string, string>, existingNodeIds: ReadonlySet<string>, createConnectionId: (connection: CanvasConnection, index: number) => string) {
    return connections.flatMap((connection, index) => {
        const toNodeId = idMap.get(connection.toNodeId);
        if (!toNodeId) return [];
        const fromNodeId = idMap.get(connection.fromNodeId) || connection.fromNodeId;
        if (!idMap.has(connection.fromNodeId) && !existingNodeIds.has(fromNodeId)) return [];
        return [{ ...connection, id: createConnectionId(connection, index), fromNodeId, toNodeId }];
    });
}

export function incomingConnectionIds(connections: CanvasConnection[], nodeId: string) {
    return connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.id);
}

export function dragDuplicateNodeIds(nodeId: string, selectedNodeIds: ReadonlySet<string>, altKey: boolean) {
    return altKey ? new Set([nodeId]) : new Set(selectedNodeIds);
}

export function expandCanvasNodeIds(nodes: CanvasNodeData[], nodeIds: ReadonlySet<string>) {
    const expanded = new Set(nodeIds);
    for (const node of nodes) {
        if (!expanded.has(node.id)) continue;
        node.metadata?.batchChildIds?.forEach((childId) => expanded.add(childId));
        if (node.type === CanvasNodeType.Group) nodes.forEach((child) => child.metadata?.groupId === node.id && expanded.add(child.id));
    }
    return expanded;
}

function remapDuplicatedMetadata(metadata: CanvasNodeMetadata | undefined, idMap: ReadonlyMap<string, string>) {
    if (!metadata) return undefined;
    const remapped = { ...metadata };
    if (metadata.groupId) remapped.groupId = idMap.get(metadata.groupId);
    if (metadata.batchRootId) remapped.batchRootId = idMap.get(metadata.batchRootId);
    if (metadata.batchChildIds) remapped.batchChildIds = metadata.batchChildIds.flatMap((id) => idMap.get(id) || []);
    if (metadata.primaryImageId && idMap.has(metadata.primaryImageId)) remapped.primaryImageId = idMap.get(metadata.primaryImageId);
    return remapped;
}
