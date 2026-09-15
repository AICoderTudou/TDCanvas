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
      exposedInput(source, draft.inspection, label, canvasPort),
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
  inspection: ComfyWorkflowInspection,
  label?: string,
  canvasPort?: boolean,
): ComfyExposedInput {
  const port =
    canvasPort ?? ["image", "video", "audio"].includes(input.valueType);
  const bypassNodeIds = port && ["image", "video", "audio"].includes(input.valueType) ? safeMediaBypassNodeIds(input, inspection) : [];
  const bypassWhenDisconnected = bypassNodeIds.length > 0;
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
    required: input.section === "required" && !bypassWhenDisconnected,
    canvasPort: port,
    ...(bypassWhenDisconnected ? { bypassWhenDisconnected: true } : {}),
    ...(bypassNodeIds.length ? { bypassNodeIds } : {}),
    ...(Object.keys(constraints).length ? { constraints } : {}),
    ...(input.enumValues?.length ? { enumValues: [...input.enumValues] } : {}),
  };
}

function safeMediaBypassNodeIds(
  input: ComfyInspectedInput,
  inspection: ComfyWorkflowInspection,
) {
  const bypassed = new Set([input.nodeId]);
  const pending = [input.nodeId];
  let foundBoundary = false;
  while (pending.length) {
    const nodeId = pending.shift()!;
    const consumers = inspection.inputs.filter((candidate) => candidate.internalLink && Array.isArray(candidate.currentValue) && String(candidate.currentValue[0]) === nodeId);
    if (!consumers.length) return [];
    for (const consumer of consumers) {
      if (consumer.section === "optional") {
        foundBoundary = true;
        continue;
      }
      if (consumer.section !== "required") return [];
      const node = inspection.nodes.find((candidate) => candidate.nodeId === consumer.nodeId);
      if (!node || node.outputs.some((output) => output.outputNode)) return [];
      const externalLinks = node.inputs.filter((candidate) => candidate.internalLink && Array.isArray(candidate.currentValue) && !bypassed.has(String(candidate.currentValue[0])));
      if (externalLinks.length) return [];
      if (!bypassed.has(node.nodeId)) {
        bypassed.add(node.nodeId);
        pending.push(node.nodeId);
      }
    }
  }
  return foundBoundary ? [...bypassed] : [];
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
    label: label?.trim() || comfyOutputLabel(output),
    resourceType: output.resourceType,
    canvasPort: canvasPort ?? true,
    preview:
      preview ?? ["image", "video", "audio"].includes(output.resourceType),
  };
}

export function comfyOutputLabel(output: Pick<ComfyInspectedOutput, "outputName" | "resourceType">) {
  return output.resourceType === "video" && output.outputName.toLowerCase() === "filenames"
    ? "视频"
    : output.outputName;
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
