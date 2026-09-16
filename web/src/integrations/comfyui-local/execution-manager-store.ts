import { applyCanvasAgentOps, type CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

import { ComfyExecutionManager } from "./execution-manager";

export const comfyExecutionManager = new ComfyExecutionManager(writeProjectOps, readProject);

function readProject(projectId: string) {
    const project = useCanvasStore.getState().openProject(projectId);
    if (!project) return undefined;
    return {
        getTitle: () => useCanvasStore.getState().openProject(projectId)?.title || project.title,
        getNodes: () => useCanvasStore.getState().openProject(projectId)?.nodes || [],
        getConnections: () => useCanvasStore.getState().openProject(projectId)?.connections || [],
        applyOps: (ops: CanvasAgentOp[]) => writeProjectOps(projectId, ops),
    };
}

function writeProjectOps(projectId: string, ops: CanvasAgentOp[]) {
    const state = useCanvasStore.getState();
    const project = state.openProject(projectId);
    if (!project) return;
    const next = applyCanvasAgentOps(
        {
            projectId,
            title: project.title,
            nodes: project.nodes,
            connections: project.connections,
            selectedNodeIds: [],
            viewport: project.viewport,
        },
        ops,
    );
    state.updateProject(projectId, {
        nodes: next.nodes,
        connections: next.connections,
        viewport: next.viewport,
    });
}
