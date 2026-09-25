import { describe, expect, it, vi } from "vitest";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { ComfyExecutionManager, type ComfyProjectAdapter } from "./execution-manager";

describe("ComfyExecutionManager", () => {
    it("isolates identical node ids by project and writes through the mounted project", () => {
        const fallback = vi.fn();
        const applyA = vi.fn();
        const manager = new ComfyExecutionManager((projectId, ops) => fallback(projectId, ops));
        const unregister = manager.registerProject("canvas-a", adapter(applyA));

        expect(manager.beginRun("canvas-a", "workflow")).not.toBeNull();
        expect(manager.beginRun("canvas-b", "workflow")).not.toBeNull();
        expect(manager.beginRun("canvas-a", "workflow")).toBeNull();

        const ops: CanvasAgentOp[] = [{ type: "update_node", id: "workflow", metadata: { status: "loading" } }];
        manager.applyOps("canvas-a", ops);
        expect(applyA).toHaveBeenCalledWith(ops);
        expect(fallback).not.toHaveBeenCalled();

        unregister();
        manager.applyOps("canvas-a", ops);
        expect(fallback).toHaveBeenCalledWith("canvas-a", ops);
    });

    it("keeps a submitted run alive after its canvas unregisters and cancels only the addressed run", () => {
        const fallbackProject = adapter(vi.fn());
        const manager = new ComfyExecutionManager(vi.fn(), (projectId) => (projectId === "canvas-a" ? fallbackProject : undefined));
        const unregister = manager.registerProject("canvas-a", adapter(vi.fn()));
        const runA = manager.beginRun("canvas-a", "workflow")!;
        const runB = manager.beginRun("canvas-b", "workflow")!;
        runA.promptId = "prompt-a";
        runB.promptId = "prompt-b";

        unregister();
        expect(manager.getRun("canvas-a", "workflow")).toBe(runA);
        expect(manager.project("canvas-a")).toBe(fallbackProject);
        expect(manager.cancelRun("canvas-a", "workflow")).toBe(runA);
        expect(runA.canceled).toBe(true);
        expect(runB.canceled).toBe(false);
    });
});

function adapter(applyOps: (ops: CanvasAgentOp[]) => void): ComfyProjectAdapter {
    return {
        getTitle: () => "画布",
        getNodes: () => [],
        getConnections: () => [],
        applyOps,
    };
}
