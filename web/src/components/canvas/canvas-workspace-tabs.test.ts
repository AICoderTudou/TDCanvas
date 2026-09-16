import { describe, expect, it } from "vitest";

import { closeCanvasTab, openCanvasTab } from "./canvas-workspace-tabs-model";

describe("CanvasWorkspaceTabs", () => {
    it("opens canvases once and preserves their order", () => {
        expect(openCanvasTab([], "a")).toEqual(["a"]);
        expect(openCanvasTab(["a", "b"], "a")).toEqual(["a", "b"]);
        expect(openCanvasTab(["a"], "b")).toEqual(["a", "b"]);
    });

    it("chooses an adjacent canvas when the active tab closes", () => {
        expect(closeCanvasTab(["a", "b", "c"], "b", "b")).toEqual({ projectIds: ["a", "c"], nextProjectId: "c" });
        expect(closeCanvasTab(["a", "c"], "c", "c")).toEqual({ projectIds: ["a"], nextProjectId: "a" });
        expect(closeCanvasTab(["a", "c"], "a", "c")).toEqual({ projectIds: ["c"], nextProjectId: "c" });
    });
});
