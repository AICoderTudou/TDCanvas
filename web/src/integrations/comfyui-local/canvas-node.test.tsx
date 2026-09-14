import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import type { ComfyWorkflowDefinition } from "./index";
import { comfyCanvasPorts, createComfyCanvasNodeSnapshot, createComfyWorkflowCanvasNode, mergeComfyCanvasNodeSnapshot, registerComfyWorkflowCanvasNode } from "./canvas-node";

const definition: ComfyWorkflowDefinition = {
    id: "workflow-rain-city",
    name: "Rain city",
    description: "A local image workflow",
    environmentId: "environment-local",
    apiWorkflow: {
        "6": { class_type: "CLIPTextEncode", inputs: { text: "rain at night" } },
        "9": { class_type: "SaveImage", inputs: { images: ["8", 0] } },
    },
    workflowHash: "0123456789abcdef",
    inputs: [
        {
            id: "6:text",
            nodeId: "6",
            field: "text",
            label: "Prompt",
            valueType: "string",
            control: "textarea",
            defaultValue: "rain at night",
            required: true,
            canvasPort: true,
        },
        {
            id: "3:seed",
            nodeId: "3",
            field: "seed",
            label: "Seed",
            valueType: "integer",
            control: "number",
            defaultValue: 42,
            required: true,
            canvasPort: false,
        },
    ],
    outputs: [
        {
            id: "9:result",
            nodeId: "9",
            resultField: "images",
            label: "Final image",
            resourceType: "image",
            canvasPort: true,
            preview: true,
        },
    ],
    dependencySnapshot: {
        nodeCount: 2,
        classTypes: ["CLIPTextEncode", "SaveImage"],
        customNodeCount: 0,
        missingClassTypes: [],
        runnable: true,
        verifiedAt: "2026-08-27T00:00:00.000Z",
    },
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("ComfyUI workflow canvas node", () => {
    it("maps only exposed canvas inputs and outputs to stable named ports", () => {
        const ports = comfyCanvasPorts({
            workflowId: definition.id,
            environmentId: definition.environmentId,
            workflowHash: definition.workflowHash,
            runnable: true,
            inputs: definition.inputs,
            outputs: definition.outputs,
            values: {},
        });

        expect(ports).toEqual([
            { id: "6:text", label: "Prompt", direction: "input", dataType: "text", required: true, multiple: false },
            { id: "9:result", label: "Final image", direction: "output", dataType: "image", multiple: true },
        ]);
    });

    it("hides bypassed input ports and naturally sorts the remaining media ports", () => {
        const mediaInput = (label: string, valueType: "image" | "audio", nodeId: string): ComfyWorkflowDefinition["inputs"][number] => ({
            id: `${nodeId}:${label}`,
            nodeId,
            field: label,
            label,
            valueType,
            control: "media",
            defaultValue: "",
            required: false,
            canvasPort: true,
        });
        const inputs = [mediaInput("image5", "image", "5"), mediaInput("image6", "image", "6"), mediaInput("image10", "image", "10"), mediaInput("image2", "image", "2"), mediaInput("image1", "image", "1"), mediaInput("audio2", "audio", "12"), mediaInput("audio1", "audio", "11")];
        const ports = comfyCanvasPorts({
            workflowId: definition.id,
            environmentId: definition.environmentId,
            workflowHash: definition.workflowHash,
            runnable: true,
            inputs,
            outputs: definition.outputs,
            values: {},
            inputEnabled: { [inputs[1]!.id]: false },
        });

        expect(ports.map((port) => port.label)).toEqual(["image1", "image2", "image5", "image10", "audio1", "audio2", "Final image"]);
    });

    it("embeds an immutable workflow snapshot when adding the macro to a canvas", () => {
        registerComfyWorkflowCanvasNode();
        const node = createComfyWorkflowCanvasNode(definition, { x: 500, y: 400 });

        expect(node).toMatchObject({
            type: "comfyui-local:workflow",
            title: "Rain city",
            position: { x: 270, y: 260 },
            width: 460,
            height: 280,
            metadata: {
                status: "idle",
                comfyuiLocal: {
                    workflowId: "workflow-rain-city",
                    environmentId: "environment-local",
                    workflowHash: "0123456789abcdef",
                    runnable: true,
                    values: { "6:text": "rain at night", "3:seed": 42 },
                },
            },
        });
    });

    it("keeps current values and bypass switches when exposed inputs are edited", () => {
        const previous = { ...createComfyCanvasNodeSnapshot(definition), values: { "6:text": "edited", "3:seed": 99 }, inputEnabled: { "6:text": false } };
        const nextDefinition = { ...definition, inputs: [definition.inputs[0]!] };
        expect(mergeComfyCanvasNodeSnapshot(nextDefinition, previous)).toMatchObject({ values: { "6:text": "edited" }, inputEnabled: { "6:text": false } });
    });
});
