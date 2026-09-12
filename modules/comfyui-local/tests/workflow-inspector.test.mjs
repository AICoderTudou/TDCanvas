import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ComfyWorkflowParseError,
  buildComfyWorkflowDefinition,
  inspectComfyWorkflow,
  materializeComfyWorkflow,
  parseComfyApiWorkflow,
} from "../dist/core/src/index.js";

const fixture = async (name) =>
  JSON.parse(
    await readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  );

test("parses API format and preserves every internal node", async () => {
  const workflow = parseComfyApiWorkflow(await fixture("basic-image-api.json"));
  assert.deepEqual(Object.keys(workflow), ["3", "4", "6", "9"]);
  assert.equal(workflow["6"].inputs.text, "a rainy city at night");
});

test("rejects a normal UI workflow instead of guessing a conversion", () => {
  assert.throws(
    () =>
      parseComfyApiWorkflow({
        nodes: [{ id: 1, type: "KSampler" }],
        links: [],
      }),
    (error) =>
      error instanceof ComfyWorkflowParseError &&
      error.code === "ui-workflow-not-supported",
  );
});

test("merges API JSON with object_info and finds safe exposed inputs", async () => {
  const workflow = parseComfyApiWorkflow(await fixture("basic-image-api.json"));
  const inspection = inspectComfyWorkflow(
    workflow,
    await fixture("basic-object-info.json"),
  );
  assert.equal(inspection.runnable, true);
  assert.deepEqual(inspection.missingClassTypes, []);

  const prompt = inspection.inputs.find((input) => input.id === "6:text");
  assert.equal(prompt?.valueType, "string");
  assert.equal(prompt?.recommended, true);

  const seed = inspection.inputs.find((input) => input.id === "3:seed");
  assert.equal(seed?.valueType, "integer");
  assert.equal(seed?.options.max, 999999999);
  assert.equal(seed?.recommended, false);

  const checkpoint = inspection.inputs.find(
    (input) => input.id === "4:ckpt_name",
  );
  assert.deepEqual(checkpoint?.enumValues, [
    "model.safetensors",
    "other.safetensors",
  ]);
  assert.equal(checkpoint?.recommended, false);

  const filename = inspection.inputs.find(
    (input) => input.id === "9:filename_prefix",
  );
  assert.equal(filename?.recommended, false);

  const internalModel = inspection.inputs.find(
    (input) => input.id === "3:model",
  );
  assert.equal(internalModel?.internalLink, true);
  assert.equal(internalModel?.exposable, false);

  const saveImage = inspection.outputs.find(
    (output) => output.id === "9:result",
  );
  assert.equal(saveImage?.resourceType, "image");
  assert.equal(saveImage?.exposable, true);
});

test("recommends prompt and media entry inputs without selecting unrelated parameters", () => {
  const workflow = parseComfyApiWorkflow({
    1: {
      class_type: "LoadImage",
      inputs: { image: "reference.png", upload: "image" },
    },
    2: {
      class_type: "TextPrompt",
      inputs: { prompt: "make it cinematic", batch_size: 1 },
    },
  });
  const inspection = inspectComfyWorkflow(workflow, {
    LoadImage: {
      input: { required: { image: ["STRING"], upload: ["STRING"] } },
      output: ["IMAGE"],
    },
    TextPrompt: {
      input: {
        required: {
          prompt: ["STRING", { multiline: true }],
          batch_size: ["INT", { min: 1, max: 8 }],
        },
      },
      output: ["STRING"],
    },
  });

  assert.equal(
    inspection.inputs.find((input) => input.id === "1:image")?.valueType,
    "image",
  );
  assert.equal(
    inspection.inputs.find((input) => input.id === "1:image")?.recommended,
    true,
  );
  assert.equal(
    inspection.inputs.find((input) => input.id === "1:upload")?.recommended,
    false,
  );
  assert.equal(
    inspection.inputs.find((input) => input.id === "2:prompt")?.recommended,
    true,
  );
  assert.equal(
    inspection.inputs.find((input) => input.id === "2:batch_size")?.recommended,
    false,
  );
});

test("reports missing custom nodes and blocks runnable state", async () => {
  const workflow = parseComfyApiWorkflow(await fixture("basic-image-api.json"));
  workflow["88"] = { class_type: "MissingCustomNode", inputs: { amount: 1 } };
  const inspection = inspectComfyWorkflow(
    workflow,
    await fixture("basic-object-info.json"),
  );
  assert.equal(inspection.runnable, false);
  assert.deepEqual(inspection.missingClassTypes, ["MissingCustomNode"]);
  assert.equal(
    inspection.nodes.find((node) => node.nodeId === "88")?.missing,
    true,
  );
});

test("builds a stable macro definition from explicitly selected inputs and outputs", async () => {
  const workflow = parseComfyApiWorkflow(await fixture("basic-image-api.json"));
  const inspection = inspectComfyWorkflow(
    workflow,
    await fixture("basic-object-info.json"),
  );
  const definition = buildComfyWorkflowDefinition({
    id: "workflow-1",
    name: "  Rain city  ",
    environmentId: "env-1",
    inspection,
    inputs: [
      {
        source: inspection.inputs.find((input) => input.id === "6:text"),
        label: "Prompt",
        canvasPort: true,
      },
      {
        source: inspection.inputs.find((input) => input.id === "3:seed"),
        canvasPort: false,
      },
    ],
    outputs: [
      {
        source: inspection.outputs.find((output) => output.id === "9:result"),
        label: "Final image",
      },
    ],
    now: "2026-08-27T00:00:00.000Z",
  });

  assert.equal(definition.name, "Rain city");
  assert.equal(definition.inputs[0].control, "textarea");
  assert.equal(definition.inputs[0].canvasPort, true);
  assert.equal(definition.outputs[0].resourceType, "image");
  assert.equal(definition.outputs[0].resultField, "images");
  assert.equal(definition.dependencySnapshot.runnable, true);
  assert.match(definition.workflowHash, /^[0-9a-f]{16}$/);

  const materialized = materializeComfyWorkflow(
    definition,
    { "6:text": "edited prompt", "3:seed": 7 },
    { "6:text": "connected prompt" },
  );
  assert.equal(materialized["6"].inputs.text, "connected prompt");
  assert.equal(materialized["3"].inputs.seed, 7);
  assert.equal(definition.apiWorkflow["6"].inputs.text, "a rainy city at night");
});
