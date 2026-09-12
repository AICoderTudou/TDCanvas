import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { connectionHandles, getConnectionHandleAnchor } from "@/lib/canvas/canvas-node-ports";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    running,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    running?: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const flowColor = themeName === "dark" ? "#f5f7ff" : "#6577bd";
    const handles = connectionHandles(connection);
    const start = getConnectionHandleAnchor(from, handles.source);
    const end = getConnectionHandleAnchor(to, handles.target);
    if (!start || !end) return null;
    const startX = start.x;
    const startY = start.y;
    const endX = end.x;
    const endY = end.y;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;

    return (
        <g>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path
                d={pathD}
                stroke={active ? theme.node.activeStroke : theme.node.muted}
                strokeWidth={active ? 3 : 2}
                strokeOpacity={active ? 1 : 0.82}
                fill="none"
                style={{ filter: active ? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)` : undefined, pointerEvents: "none" }}
            />
            {running ? (
                <g data-connection-running="true" aria-hidden="true">
                    <path className="td-canvas-connection-running-glow" d={pathD} pathLength="100" stroke={flowColor} strokeWidth="5" strokeLinecap="round" fill="none" style={{ color: flowColor }} />
                    <path className="td-canvas-connection-running-flow" d={pathD} pathLength="100" stroke={flowColor} strokeWidth="2.4" strokeLinecap="round" fill="none" style={{ color: flowColor }} />
                </g>
            ) : null}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target, targetHandle }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData; targetHandle?: ConnectionHandle }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const fixed = getConnectionHandleAnchor(node, handle);
    if (!fixed) return null;
    const snapped = (target ? getConnectionHandleAnchor(target, targetHandle || { nodeId: target.id, handleType: handle.handleType === "source" ? "target" : "source" }) : null) || mouseWorld;
    const snappedStartX = handle.handleType === "source" ? fixed.x : snapped.x;
    const snappedStartY = handle.handleType === "source" ? fixed.y : snapped.y;
    const snappedEndX = handle.handleType === "source" ? snapped.x : fixed.x;
    const snappedEndY = handle.handleType === "source" ? snapped.y : fixed.y;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
