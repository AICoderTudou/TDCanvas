import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type ComfyActiveRun = { promptId?: string; canceled: boolean };

export type ComfyProjectAdapter = {
    getTitle: () => string;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    applyOps: (ops: CanvasAgentOp[]) => void;
};

type FallbackWriter = (projectId: string, ops: CanvasAgentOp[]) => void;
type FallbackReader = (projectId: string) => ComfyProjectAdapter | undefined;

export class ComfyExecutionManager {
    private readonly projects = new Map<string, ComfyProjectAdapter>();
    private readonly runs = new Map<string, ComfyActiveRun>();

    constructor(
        private readonly fallbackWriter: FallbackWriter,
        private readonly fallbackReader?: FallbackReader,
    ) {}

    registerProject(projectId: string, adapter: ComfyProjectAdapter) {
        this.projects.set(projectId, adapter);
        return () => {
            if (this.projects.get(projectId) === adapter) this.projects.delete(projectId);
        };
    }

    beginRun(projectId: string, nodeId: string) {
        const key = runKey(projectId, nodeId);
        if (this.runs.has(key)) return null;
        const run: ComfyActiveRun = { canceled: false };
        this.runs.set(key, run);
        return run;
    }

    getRun(projectId: string, nodeId: string) {
        return this.runs.get(runKey(projectId, nodeId));
    }

    hasNodeRun(nodeId: string) {
        return [...this.runs.keys()].some((key) => key.endsWith(`\u0000${nodeId}`));
    }

    cancelRun(projectId: string, nodeId: string) {
        const run = this.getRun(projectId, nodeId);
        if (run) run.canceled = true;
        return run;
    }

    endRun(projectId: string, nodeId: string, run: ComfyActiveRun) {
        const key = runKey(projectId, nodeId);
        if (this.runs.get(key) === run) this.runs.delete(key);
    }

    project(projectId: string) {
        return this.projects.get(projectId) || this.fallbackReader?.(projectId);
    }

    applyOps(projectId: string, ops: CanvasAgentOp[]) {
        const project = this.projects.get(projectId);
        if (project) project.applyOps(ops);
        else this.fallbackWriter(projectId, ops);
    }
}

function runKey(projectId: string, nodeId: string) {
    return `${projectId}\u0000${nodeId}`;
}
