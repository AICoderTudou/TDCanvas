import { describe, expect, it } from "vitest";

import type { ComfyInspectedInput } from "./index";
import { defaultComfyPortIds, filterComfySelectionItemsByNodeId, groupComfySelectionItems, smartDefaultComfyInputIds } from "./workflow-selection";

const input = (id: string, nodeId: string, recommended: boolean, valueType: ComfyInspectedInput["valueType"] = "string"): ComfyInspectedInput => ({
    id,
    nodeId,
    classType: nodeId === "12" ? "CLIPTextEncode" : "KSampler",
    nodeTitle: nodeId === "12" ? "提示词编码" : "采样器",
    field: id.split(":")[1],
    label: id,
    section: "required",
    currentValue: "",
    valueType,
    internalLink: false,
    exposable: true,
    recommended,
    options: valueType === "string" ? { multiline: true } : {},
});

describe("ComfyUI workflow input selection", () => {
    const inputs = [input("12:text", "12", true), input("31:image", "31", true, "image"), input("3:seed", "3", false, "integer")];

    it("starts with only recognized prompt and media inputs selected", () => {
        expect(smartDefaultComfyInputIds(inputs)).toEqual(["12:text", "31:image"]);
        expect(defaultComfyPortIds(inputs, ["9:result"])).toEqual(["12:text", "31:image", "9:result"]);
    });

    it("searches strictly by node id and accepts a leading hash", () => {
        expect(filterComfySelectionItemsByNodeId(inputs, "#12").map((item) => item.id)).toEqual(["12:text"]);
        expect(filterComfySelectionItemsByNodeId(inputs, "采样器")).toEqual([]);
    });

    it("groups parameters beneath their ComfyUI node id", () => {
        const groups = groupComfySelectionItems([inputs[0], input("12:negative", "12", true), inputs[2]]);
        expect(groups.map((group) => [group.nodeId, group.items.length])).toEqual([
            ["12", 2],
            ["3", 1],
        ]);
    });
});
