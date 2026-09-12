import type {
  ComfyDependencySnapshot,
  ComfyExposedInput,
  ComfyExposedOutput,
  ComfyInputControl,
  ComfyInspectedInput,
  ComfyInspectedOutput,
  ComfyWorkflowDefinition,
  ComfyWorkflowInspection,
} from "../../contracts/src/index.js";

export type ComfyWorkflowDefinitionDraft = {
  id: string;
  name: string;
  description?: string;
  environmentId: string;
  inspection: ComfyWorkflowInspection;
  inputs: Array<{
    source: ComfyInspectedInput;
    label?: string;
    canvasPort?: boolean;
  }>;
  outputs: Array<{
    source: ComfyInspectedOutput;
    label?: string;
    canvasPort?: boolean;
    preview?: boolean;
  }>;
  now?: string;
};

export function buildComfyWorkflowDefinition(
  draft: ComfyWorkflowDefinitionDraft,
): ComfyWorkflowDefinition {
  const now = draft.now || new Date().toISOString();
  const name = draft.name.trim();
  if (!name) throw new Error("工作流名称不能为空");
  if (!draft.environmentId.trim())
    throw new Error("工作流必须绑定 ComfyUI 环境");
  if (!draft.outputs.length) throw new Error("至少选择一个工作流输出");
  return {
    id: draft.id,
    name,
    description: draft.description?.trim() || undefined,
    environmentId: draft.environmentId,
    apiWorkflow: cloneJson(draft.inspection.workflow),
    workflowHash: comfyWorkflowHash(draft.inspection.workflow),
    inputs: draft.inputs.map(({ source, label, canvasPort }) =>
      exposedInput(source, label, canvasPort),
    ),
    outputs: draft.outputs.map(({ source, label, canvasPort, preview }) =>
      exposedOutput(source, label, canvasPort, preview),
    ),
    dependencySnapshot: dependencySnapshot(draft.inspection, now),
    createdAt: now,
    updatedAt: now,
  };
}

export function comfyInputControl(
  input: ComfyInspectedInput,
): ComfyInputControl {
  if (
    input.valueType === "image" ||
    input.valueType === "video" ||
    input.valueType === "audio"
  )
    return "media";
  if (input.valueType === "boolean") return "switch";
  if (input.valueType === "enum") return "select";
  if (input.valueType === "integer" || input.valueType === "number")
    return "number";
  if (input.valueType === "json") return "json";
  return input.options.multiline ? "textarea" : "text";
}

export function comfyWorkflowHash(
  workflow: ComfyWorkflowInspection["workflow"],
) {
  const text = JSON.stringify(workflow);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const byte of new TextEncoder().encode(text)) {
    left = Math.imul(left ^ byte, 0x01000193) >>> 0;
    right = Math.imul(right ^ byte, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

function exposedInput(
  input: ComfyInspectedInput,
  label?: string,
  canvasPort?: boolean,
): ComfyExposedInput {
  const constraints = {
    ...(typeof input.options.min === "number"
      ? { min: input.options.min }
      : {}),
    ...(typeof input.options.max === "number"
      ? { max: input.options.max }
      : {}),
    ...(typeof input.options.step === "number"
      ? { step: input.options.step }
      : {}),
  };
  return {
    id: input.id,
    nodeId: input.nodeId,
    field: input.field,
    label: label?.trim() || input.label,
    valueType: input.valueType,
    control: comfyInputControl(input),
    defaultValue: cloneJson(input.currentValue),
    required: input.section === "required",
    canvasPort:
      canvasPort ?? ["image", "video", "audio"].includes(input.valueType),
    ...(Object.keys(constraints).length ? { constraints } : {}),
    ...(input.enumValues?.length ? { enumValues: [...input.enumValues] } : {}),
  };
}

function exposedOutput(
  output: ComfyInspectedOutput,
  label?: string,
  canvasPort?: boolean,
  preview?: boolean,
): ComfyExposedOutput {
  return {
    id: output.id,
    nodeId: output.nodeId,
    outputIndex: output.outputIndex,
    resultField: output.outputNode
      ? resourceResultField(output.resourceType)
      : undefined,
    label: label?.trim() || output.outputName,
    resourceType: output.resourceType,
    canvasPort: canvasPort ?? true,
    preview:
      preview ?? ["image", "video", "audio"].includes(output.resourceType),
  };
}

function resourceResultField(resourceType: ComfyExposedOutput["resourceType"]) {
  if (resourceType === "image") return "images";
  if (resourceType === "video") return "videos";
  if (resourceType === "audio") return "audio";
  if (resourceType === "text") return "text";
  if (resourceType === "file") return "files";
  return undefined;
}

function dependencySnapshot(
  inspection: ComfyWorkflowInspection,
  verifiedAt: string,
): ComfyDependencySnapshot {
  const classTypes = [
    ...new Set(inspection.nodes.map((node) => node.classType)),
  ].sort();
  return {
    nodeCount: inspection.nodes.length,
    classTypes,
    customNodeCount: inspection.nodes.filter((node) =>
      Boolean(node.pythonModule && !node.pythonModule.startsWith("nodes")),
    ).length,
    missingClassTypes: [...inspection.missingClassTypes],
    runnable: inspection.runnable,
    verifiedAt,
  };
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
