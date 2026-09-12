import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodePort, type ConnectionHandle, type Position } from "@/types/canvas";

export type ResolvedCanvasNodePort = CanvasNodePort & { legacy?: boolean };

const legacyInput: ResolvedCanvasNodePort = { id: "__legacy-input", label: "输入", direction: "input", dataType: "any", multiple: true, legacy: true };
const legacyOutput: ResolvedCanvasNodePort = { id: "__legacy-output", label: "输出", direction: "output", dataType: "any", multiple: true, legacy: true };

export function getCanvasNodePorts(node: CanvasNodeData): ResolvedCanvasNodePort[] {
    if (node.type === CanvasNodeType.Group) return [];
    const definition = getNodeDefinition(node.type);
    if (definition?.ports) {
        try {
            const ports = typeof definition.ports === "function" ? definition.ports(node) : definition.ports;
            const seen = new Set<string>();
            return ports.filter((port) => {
                const key = `${port.direction}:${port.id}`;
                if (!port.id || !port.label || typeof port.dataType !== "string" || !port.dataType.trim() || (port.direction !== "input" && port.direction !== "output") || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        } catch {
            return [];
        }
    }
    return node.type === CanvasNodeType.Config || definition?.hasSourceHandle === false ? [legacyInput] : [legacyInput, legacyOutput];
}

export function getHandlePorts(node: CanvasNodeData, handleType: ConnectionHandle["handleType"]) {
    const direction = handleType === "source" ? "output" : "input";
    return getCanvasNodePorts(node).filter((port) => port.direction === direction);
}

export function getCanvasPort(node: CanvasNodeData, handle: Pick<ConnectionHandle, "handleType" | "portId">) {
    const ports = getHandlePorts(node, handle.handleType);
    if (handle.portId) return ports.find((port) => port.id === handle.portId);
    return ports.find((port) => port.legacy) || (ports.length === 1 ? ports[0] : undefined);
}

export function canvasPortHandle(nodeId: string, handleType: ConnectionHandle["handleType"], port: ResolvedCanvasNodePort): ConnectionHandle {
    return { nodeId, handleType, portId: port.legacy ? undefined : port.id };
}

export function getConnectionHandleAnchor(node: CanvasNodeData, handle: Pick<ConnectionHandle, "handleType" | "portId">): Position | null {
    const ports = getHandlePorts(node, handle.handleType);
    const port = getCanvasPort(node, handle);
    if (!port) return null;
    const index = ports.findIndex((item) => item.id === port.id);
    if (index < 0) return null;
    return {
        x: handle.handleType === "source" ? node.position.x + node.width : node.position.x,
        y: node.position.y + (node.height * (index + 1)) / (ports.length + 1),
    };
}

export function areCanvasPortTypesCompatible(source?: CanvasNodePort, target?: CanvasNodePort) {
    if (!source || !target || typeof source.dataType !== "string" || typeof target.dataType !== "string") return false;
    const sourceType = source.dataType.toLowerCase();
    const targetType = target.dataType.toLowerCase();
    return sourceType === "any" || targetType === "any" || sourceType === targetType;
}

export function normalizeConnectionHandles(first: ConnectionHandle, second: ConnectionHandle, nodes: CanvasNodeData[], connections: CanvasConnection[] = []): Omit<CanvasConnection, "id"> | null {
    const firstNode = nodes.find((node) => node.id === first.nodeId);
    const secondNode = nodes.find((node) => node.id === second.nodeId);
    if (!firstNode || !secondNode || firstNode.id === secondNode.id || first.handleType === second.handleType) return null;
    if (firstNode.type === CanvasNodeType.Group || secondNode.type === CanvasNodeType.Group) return null;

    const sourceHandle = first.handleType === "source" ? first : second;
    const targetHandle = first.handleType === "target" ? first : second;
    const sourceNode = sourceHandle === first ? firstNode : secondNode;
    const targetNode = targetHandle === first ? firstNode : secondNode;
    const sourcePort = getCanvasPort(sourceNode, sourceHandle);
    const targetPort = getCanvasPort(targetNode, targetHandle);
    if (!areCanvasPortTypesCompatible(sourcePort, targetPort)) return null;
    const storedTargetPortId = targetPort?.legacy ? undefined : targetPort?.id;
    if (!targetPort?.multiple && connections.some((connection) => connection.toNodeId === targetNode.id && connection.toPortId === storedTargetPortId)) return null;

    return {
        fromNodeId: sourceNode.id,
        toNodeId: targetNode.id,
        fromPortId: sourcePort?.legacy ? undefined : sourcePort?.id,
        toPortId: targetPort?.legacy ? undefined : targetPort?.id,
    };
}

export function connectionHandles(connection: CanvasConnection): { source: ConnectionHandle; target: ConnectionHandle } {
    return {
        source: { nodeId: connection.fromNodeId, handleType: "source", portId: connection.fromPortId },
        target: { nodeId: connection.toNodeId, handleType: "target", portId: connection.toPortId },
    };
}
