import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasObjectReference } from "@/types/canvas";
import type { CanvasNodeResource } from "@/types/canvas-plugin";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    connectionId?: string;
    objectReferenceId?: string;
    source: "connection" | "object" | "self";
    outputPortId?: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export type CanvasConnectedResource = {
    node: CanvasNodeData;
    connectionId?: string;
    objectReferenceId?: string;
    outputPortId?: string;
    resource: CanvasNodeResource;
};

export function reorderCanvasConnections(connections: CanvasConnection[], sourceConnectionId: string, targetConnectionId: string) {
    const sourceIndex = connections.findIndex((connection) => connection.id === sourceConnectionId);
    const targetIndex = connections.findIndex((connection) => connection.id === targetConnectionId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return connections;
    const source = connections[sourceIndex];
    const target = connections[targetIndex];
    if (!source || !target || source.toNodeId !== target.toNodeId || source.toPortId !== target.toPortId) return connections;

    // Reorder only this node's input slots. Other nodes' connections keep their
    // original positions so their resource order and edge stacking stay intact.
    const inputIndexes = connections.flatMap((connection, index) => (connection.toNodeId === source.toNodeId && connection.toPortId === source.toPortId ? [index] : []));
    const inputs = inputIndexes.map((index) => connections[index]!);
    const sourceInputIndex = inputs.findIndex((connection) => connection.id === sourceConnectionId);
    const targetInputIndex = inputs.findIndex((connection) => connection.id === targetConnectionId);
    const [moved] = inputs.splice(sourceInputIndex, 1);
    inputs.splice(Math.min(targetInputIndex, inputs.length), 0, moved!);

    const next = [...connections];
    inputIndexes.forEach((connectionIndex, inputIndex) => {
        next[connectionIndex] = inputs[inputIndex]!;
    });
    return next;
}

export function reorderCanvasObjectReferences(references: CanvasObjectReference[], sourceReferenceId: string, targetReferenceId: string) {
    const sourceIndex = references.findIndex((reference) => reference.id === sourceReferenceId);
    const targetIndex = references.findIndex((reference) => reference.id === targetReferenceId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return references;
    const next = [...references];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(Math.min(targetIndex, next.length), 0, moved!);
    return next;
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return labelResourceInputs(getMentionResourceInputs(node.id, nodes, connections), true);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceInputs(nodeId, nodes, connections);
    if (configInputs.length) return configInputs.map((input) => input.node);
    const ownInputs = getContextResourceInputs(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs.map((input) => input.node);
    const node = nodes.find((item) => item.id === nodeId);
    const resource = node ? resolveCanvasNodeResource(node) : null;
    return node && resource ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return getGenerationResourceInputs(nodeId, nodes, connections).map((input) => input.node);
}

export function getGenerationResourceInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceInputs(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    return getContextResourceInputs(nodeId, nodes, connections);
}

function getContextResourceInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const connectedInputs = connections.flatMap((connection) => {
        if (connection.toNodeId !== nodeId) return [];
        const node = nodes.find((item) => item.id === connection.fromNodeId);
        const resource = node ? resolveCanvasNodeResource(node, connection.fromPortId) : null;
        return node && resource ? [{ node, connectionId: connection.id, outputPortId: connection.fromPortId, resource }] : [];
    });
    const connectedKeys = new Set(connectedInputs.map(({ node, outputPortId }) => `${node.id}:${outputPortId || ""}`));
    const target = nodes.find((item) => item.id === nodeId);
    const objectInputs = (target?.metadata?.objectReferences || []).flatMap((reference) => {
        const node = nodes.find((item) => item.id === reference.sourceNodeId);
        const resource = node ? resolveCanvasObjectReferenceResource(node, reference) : null;
        const key = node ? `${node.id}:${reference.outputPortId || ""}` : "";
        return node && resource && !connectedKeys.has(key) ? [{ node, objectReferenceId: reference.id, outputPortId: reference.outputPortId, resource }] : [];
    });
    return [...connectedInputs, ...objectInputs];
}

function getMentionResourceInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (configConnection) {
        const configInputs = getContextResourceInputs(configConnection.toNodeId, nodes, connections).filter(({ node }) => node.id !== nodeId);
        if (configInputs.length) return configInputs;
    }
    const ownInputs = getContextResourceInputs(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    const node = nodes.find((item) => item.id === nodeId);
    const resource = node ? resolveCanvasNodeResource(node) : null;
    return node && resource ? [{ node, connectionId: undefined, resource }] : [];
}

function getConnectedConfigResourceInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextResourceInputs(configConnection.toNodeId, nodes, connections).filter(({ node }) => node.id !== nodeId);
}

function labelResourceInputs(inputs: CanvasConnectedResource[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return inputs.flatMap(({ node, connectionId, objectReferenceId, outputPortId, resource }): CanvasResourceReference[] => {
        const kind = resource.kind;
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: connectionId || objectReferenceId || node.id,
                connectionId,
                objectReferenceId,
                source: connectionId ? "connection" : objectReferenceId ? "object" : "self",
                outputPortId,
                nodeId: node.id,
                kind,
                label,
                title: resource.name || node.title || label,
                previewUrl: resource.url || resource.text,
                text: resource.kind === "text" ? resource.text : undefined,
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

export function resolveCanvasNodeResource(node: CanvasNodeData, outputPortId?: string): CanvasNodeResource | null {
    const content = node.metadata?.content;
    if (node.type === CanvasNodeType.Image && content) return { kind: "image", url: content, mimeType: node.metadata?.mimeType, storageKey: node.metadata?.storageKey, localPath: node.metadata?.localPath };
    if (node.type === CanvasNodeType.Video && content) return { kind: "video", url: content, mimeType: node.metadata?.mimeType, storageKey: node.metadata?.storageKey, localPath: node.metadata?.localPath };
    if (node.type === CanvasNodeType.Audio && content) return { kind: "audio", url: content, mimeType: node.metadata?.mimeType, storageKey: node.metadata?.storageKey, localPath: node.metadata?.localPath };
    if (node.type === CanvasNodeType.Text && (content || node.metadata?.prompt)) return { kind: "text", text: content || node.metadata?.prompt };
    // Plugin nodes can expose a distinct resource for each output port.
    try {
        return getNodeDefinition(node.type)?.resource?.(node, outputPortId) || null;
    } catch {
        return null;
    }
}

export function resolveCanvasObjectReferenceResource(node: CanvasNodeData, reference: CanvasObjectReference): CanvasNodeResource | null {
    if (!node.metadata?.canvasSetEnabled) return null;
    if (reference.versionMode === "pinned" && reference.versionId && node.type === CanvasNodeType.Image) {
        const version = node.metadata?.imageHistory?.find((entry) => entry.id === reference.versionId);
        if (version?.content) {
            return {
                kind: "image",
                url: version.content,
                name: version.filename || node.title,
                mimeType: version.mimeType || node.metadata?.mimeType,
                storageKey: version.storageKey,
                localPath: version.localPath,
            };
        }
    }
    return resolveCanvasNodeResource(node, reference.outputPortId);
}
