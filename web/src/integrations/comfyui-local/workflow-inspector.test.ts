import { describe, expect, it } from "vitest";

import { buildComfyWorkflowDefinition, inspectComfyWorkflow, materializeComfyWorkflow } from "./index";

describe("ComfyUI workflow output inspection", () => {
    it("treats VHS Video Combine filenames as a video output", () => {
        const inspection = inspectComfyWorkflow(
            { "9": { class_type: "VHS_VideoCombine", inputs: {} } },
            {
                VHS_VideoCombine: {
                    output: ["VHS_FILENAMES"],
                    output_name: ["Filenames"],
                    output_node: true,
                },
            },
        );

        expect(inspection.outputs[0]).toMatchObject({
            outputName: "Filenames",
            resourceType: "video",
            outputNode: true,
            exposable: true,
        });
        const definition = buildComfyWorkflowDefinition({
            id: "video-output",
            name: "video output",
            environmentId: "local",
            inspection,
            inputs: [],
            outputs: [{ source: inspection.outputs[0]! }],
        });
        expect(definition.outputs[0]).toMatchObject({ label: "视频", resourceType: "video", resultField: "videos" });
    });

    it("bypasses a disconnected media loader when every consumer input is optional", () => {
        const inspection = inspectComfyWorkflow(
            {
                "1": { class_type: "LoadImage", inputs: { image: "stale.png" } },
                "2": { class_type: "OptionalVideo", inputs: { reference: ["1", 0], prompt: "hello" } },
            },
            {
                LoadImage: {
                    input: { required: { image: ["STRING", {}] } },
                    output: ["IMAGE"],
                    output_name: ["IMAGE"],
                },
                OptionalVideo: {
                    input: { required: { prompt: ["STRING", {}] }, optional: { reference: ["IMAGE", {}] } },
                    output: ["VIDEO"],
                    output_name: ["VIDEO"],
                    output_node: true,
                },
            },
        );
        const input = inspection.inputs.find((item) => item.id === "1:image")!;
        const output = inspection.outputs.find((item) => item.id === "2:0")!;
        const definition = buildComfyWorkflowDefinition({
            id: "optional-media",
            name: "optional media",
            environmentId: "local",
            inspection,
            inputs: [{ source: input, canvasPort: true }],
            outputs: [{ source: output }],
        });

        expect(definition.inputs[0]).toMatchObject({ required: false, bypassWhenDisconnected: true });
        expect(materializeComfyWorkflow(definition, { "1:image": "stale.png" })).toEqual({
            "2": { class_type: "OptionalVideo", inputs: { prompt: "hello" } },
        });
        expect(materializeComfyWorkflow(definition, {}, { "1:image": "uploaded.png" })).toEqual({
            "1": { class_type: "LoadImage", inputs: { image: "uploaded.png" } },
            "2": { class_type: "OptionalVideo", inputs: { reference: ["1", 0], prompt: "hello" } },
        });
    });

    it("prunes a required preprocessing chain that ends at a dynamic optional input", () => {
        const inspection = inspectComfyWorkflow(
            {
                "1": { class_type: "LoadAudio", inputs: { audio: "voice.wav" } },
                "2": { class_type: "AudioSeparation", inputs: { audio: ["1", 0] } },
                "3": { class_type: "ReferenceVideo", inputs: { "ref_audios.ref_audio_0": ["2", 3], prompt: "hello" } },
            },
            {
                LoadAudio: { input: { required: { audio: ["STRING", {}] } }, output: ["AUDIO"] },
                AudioSeparation: { input: { required: { audio: ["AUDIO", {}] } }, output: ["AUDIO", "AUDIO", "AUDIO", "AUDIO"] },
                ReferenceVideo: { input: { required: { prompt: ["STRING", {}] }, optional: { ref_audios: ["COMFY_AUTOGROW_V3", { template: { input: { required: { ref_audio: ["AUDIO", {}] } } } }] } }, output: ["VIDEO"], output_node: true },
            },
        );
        const input = inspection.inputs.find((item) => item.id === "1:audio")!;
        const output = inspection.outputs.find((item) => item.id === "3:0")!;
        const definition = buildComfyWorkflowDefinition({ id: "audio-branch", name: "audio branch", environmentId: "local", inspection, inputs: [{ source: input }], outputs: [{ source: output }] });

        expect(inspection.inputs.find((item) => item.id === "3:ref_audios.ref_audio_0")?.section).toBe("optional");
        expect(definition.inputs[0]).toMatchObject({ required: false, bypassWhenDisconnected: true, bypassNodeIds: ["1", "2"] });
        expect(materializeComfyWorkflow(definition, { "1:audio": "stale.wav" })).toEqual({ "3": { class_type: "ReferenceVideo", inputs: { prompt: "hello" } } });
    });

    it("keeps a media loader when a downstream input is required", () => {
        const inspection = inspectComfyWorkflow(
            {
                "1": { class_type: "LoadImage", inputs: { image: "required.png" } },
                "2": { class_type: "RequiredVideo", inputs: { reference: ["1", 0] } },
            },
            {
                LoadImage: { input: { required: { image: ["STRING", {}] } }, output: ["IMAGE"] },
                RequiredVideo: { input: { required: { reference: ["IMAGE", {}] } }, output: ["VIDEO"], output_node: true },
            },
        );
        const input = inspection.inputs.find((item) => item.id === "1:image")!;
        const output = inspection.outputs.find((item) => item.id === "2:0")!;
        const definition = buildComfyWorkflowDefinition({
            id: "required-media",
            name: "required media",
            environmentId: "local",
            inspection,
            inputs: [{ source: input, canvasPort: true }],
            outputs: [{ source: output }],
        });

        expect(definition.inputs[0]).toMatchObject({ required: true });
        expect(definition.inputs[0].bypassWhenDisconnected).toBeUndefined();
        expect(materializeComfyWorkflow(definition, {})).toEqual(inspection.workflow);
        expect(() => materializeComfyWorkflow(definition, {}, {}, new Set(["1:image"]))).toThrow("没有可接续的上游");
    });

    it("reconnects downstream nodes to the single upstream link when an input node is bypassed", () => {
        const definition = {
            id: "passthrough-media",
            name: "passthrough media",
            environmentId: "local",
            apiWorkflow: {
                "1": { class_type: "LoadImage", inputs: { image: "source.png" } },
                "2": { class_type: "ImageFilter", inputs: { image: ["1", 0], strength: 1 } },
                "3": { class_type: "PreviewImage", inputs: { images: ["2", 0] } },
            },
            workflowHash: "hash",
            inputs: [{ id: "2:strength", nodeId: "2", field: "strength", label: "Filter", valueType: "image", control: "media", defaultValue: 1, required: true, canvasPort: true }],
            outputs: [{ id: "3:result", nodeId: "3", label: "Preview", resourceType: "image", canvasPort: true, preview: true }],
            dependencySnapshot: { nodeCount: 3, classTypes: [], customNodeCount: 0, missingClassTypes: [], runnable: true, verifiedAt: "now" },
            createdAt: "now",
            updatedAt: "now",
        } satisfies import("./index").ComfyWorkflowDefinition;

        expect(materializeComfyWorkflow(definition, {}, {}, new Set(["2:strength"]))).toEqual({
            "1": { class_type: "LoadImage", inputs: { image: "source.png" } },
            "3": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
        });
    });
});
