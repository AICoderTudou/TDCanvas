import type {
  ComfyApiLink,
  ComfyApiNode,
  ComfyApiWorkflow,
  ComfyInputOptions,
  ComfyInputSpec,
  ComfyInputValueType,
  ComfyInspectedInput,
  ComfyInspectedNode,
  ComfyInspectedOutput,
  ComfyObjectInfo,
  ComfyObjectInfoNode,
  ComfyOutputResourceType,
  ComfyWorkflowInspection,
} from "../../contracts/src/index.js";

export type ComfyWorkflowParseErrorCode =
  | "invalid-json-root"
  | "empty-workflow"
  | "ui-workflow-not-supported"
  | "invalid-api-node";

export class ComfyWorkflowParseError extends Error {
  constructor(
    public readonly code: ComfyWorkflowParseErrorCode,
    message: string,
    public readonly nodeId?: string,
  ) {
    super(message);
    this.name = "ComfyWorkflowParseError";
  }
}

export function parseComfyApiWorkflow(value: unknown): ComfyApiWorkflow {
  if (!isRecord(value))
    throw new ComfyWorkflowParseError(
      "invalid-json-root",
      "工作流 JSON 顶层必须是对象",
    );
  if (Array.isArray(value.nodes) || Array.isArray(value.links)) {
    throw new ComfyWorkflowParseError(
      "ui-workflow-not-supported",
      "当前文件是 ComfyUI UI 工作流，请使用 Save (API Format) 重新导出",
    );
  }
  const entries = Object.entries(value);
  if (!entries.length)
    throw new ComfyWorkflowParseError("empty-workflow", "API 工作流中没有节点");

  const workflow: ComfyApiWorkflow = {};
  for (const [nodeId, rawNode] of entries) {
    if (
      !isRecord(rawNode) ||
      typeof rawNode.class_type !== "string" ||
      !rawNode.class_type.trim() ||
      !isRecord(rawNode.inputs)
    ) {
      throw new ComfyWorkflowParseError(
        "invalid-api-node",
        `节点 ${nodeId} 缺少 class_type 或 inputs`,
        nodeId,
      );
    }
    const meta = isRecord(rawNode._meta)
      ? {
          ...rawNode._meta,
          title:
            typeof rawNode._meta.title === "string"
              ? rawNode._meta.title
              : undefined,
        }
      : undefined;
    workflow[String(nodeId)] = {
      class_type: rawNode.class_type.trim(),
      inputs: { ...rawNode.inputs },
      ...(meta ? { _meta: meta } : {}),
    };
  }
  return workflow;
}

export function inspectComfyWorkflow(
  workflow: ComfyApiWorkflow,
  objectInfo: ComfyObjectInfo,
): ComfyWorkflowInspection {
  const nodeIds = new Set(Object.keys(workflow));
  const nodes = Object.entries(workflow)
    .sort(([left], [right]) => compareNodeIds(left, right))
    .map(([nodeId, node]) =>
      inspectNode(nodeId, node, objectInfo[node.class_type], nodeIds),
    );
  const missingClassTypes = [
    ...new Set(
      nodes.filter((node) => node.missing).map((node) => node.classType),
    ),
  ].sort();
  return {
    workflow,
    nodes,
    inputs: nodes.flatMap((node) => node.inputs),
    outputs: nodes.flatMap((node) => node.outputs),
    missingClassTypes,
    runnable: missingClassTypes.length === 0,
  };
}

export function isComfyApiLink(
  value: unknown,
  nodeIds: ReadonlySet<string>,
): value is ComfyApiLink {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    (typeof value[0] === "string" || typeof value[0] === "number") &&
    Number.isInteger(value[1]) &&
    nodeIds.has(String(value[0]))
  );
}

function inspectNode(
  nodeId: string,
  node: ComfyApiNode,
  info: ComfyObjectInfoNode | undefined,
  nodeIds: ReadonlySet<string>,
): ComfyInspectedNode {
  const title =
    node._meta?.title || info?.display_name || info?.name || node.class_type;
  return {
    nodeId,
    classType: node.class_type,
    title,
    category: info?.category,
    pythonModule: info?.python_module,
    missing: !info,
    inputs: inspectInputs(nodeId, node, title, info, nodeIds),
    outputs: inspectOutputs(nodeId, node, title, info),
  };
}

function inspectInputs(
  nodeId: string,
  node: ComfyApiNode,
  nodeTitle: string,
  info: ComfyObjectInfoNode | undefined,
  nodeIds: ReadonlySet<string>,
) {
  const specs = inputSpecs(info);
  const orderedFields = orderedInputFields(node, info);
  return orderedFields.map((field): ComfyInspectedInput => {
    const currentValue = node.inputs[field];
    const spec = specs.get(field);
    const internalLink = isComfyApiLink(currentValue, nodeIds);
    const valueType = inferInputValueType(
      node.class_type,
      field,
      spec?.spec,
      currentValue,
    );
    const options = spec?.spec?.[1] || {};
    const exposable = !internalLink;
    return {
      id: `${nodeId}:${field}`,
      nodeId,
      classType: node.class_type,
      nodeTitle,
      field,
      label:
        typeof options.label === "string" && options.label.trim()
          ? options.label
          : field,
      section: spec?.section || "unknown",
      currentValue,
      valueType,
      internalLink,
      exposable,
      recommended:
        exposable &&
        isRecommendedCanvasInput(node.class_type, field, valueType, options),
      options,
      enumValues: Array.isArray(spec?.spec?.[0])
        ? [...spec.spec[0]]
        : undefined,
    };
  });
}

function isRecommendedCanvasInput(
  classType: string,
  field: string,
  valueType: ComfyInputValueType,
  options: ComfyInputOptions,
) {
  if (options.forceInput || options.defaultInput) return false;
  if (valueType === "image" || valueType === "video" || valueType === "audio")
    return true;
  if (valueType !== "string") return false;
  const signal =
    `${classType} ${field} ${typeof options.label === "string" ? options.label : ""}`.toLowerCase();
  return (
    /(^|[^a-z])(prompt|text|positive|negative|caption|instruction|description|query|lyrics)([^a-z]|$)/.test(
      signal,
    ) || signal.includes("textencode")
  );
}

function inspectOutputs(
  nodeId: string,
  node: ComfyApiNode,
  nodeTitle: string,
  info: ComfyObjectInfoNode | undefined,
): ComfyInspectedOutput[] {
  const outputTypes = Array.isArray(info?.output) ? info.output : [];
  const outputNames = Array.isArray(info?.output_name) ? info.output_name : [];
  const outputNode = Boolean(info?.output_node);

  if (!outputTypes.length && outputNode) {
    const resourceType = inferOutputNodeResource(node.class_type);
    return [
      {
        id: `${nodeId}:result`,
        nodeId,
        classType: node.class_type,
        nodeTitle,
        outputName: "result",
        resourceType,
        outputNode: true,
        exposable: resourceType !== "json",
      },
    ];
  }

  return outputTypes.map((comfyType, outputIndex) => {
    const resourceType = mapOutputResourceType(comfyType);
    return {
      id: `${nodeId}:${outputIndex}`,
      nodeId,
      classType: node.class_type,
      nodeTitle,
      outputIndex,
      outputName:
        outputNames[outputIndex] || comfyType || `output_${outputIndex + 1}`,
      comfyType,
      resourceType,
      outputNode,
      exposable: isSerializableOutput(resourceType, comfyType),
    };
  });
}

function inputSpecs(info: ComfyObjectInfoNode | undefined) {
  const result = new Map<
    string,
    { section: "required" | "optional"; spec: ComfyInputSpec }
  >();
  for (const section of ["required", "optional"] as const) {
    const values = info?.input?.[section];
    if (!values) continue;
    for (const [field, spec] of Object.entries(values)) {
      if (Array.isArray(spec)) result.set(field, { section, spec });
    }
  }
  return result;
}

function orderedInputFields(
  node: ComfyApiNode,
  info: ComfyObjectInfoNode | undefined,
) {
  const preferred = [
    ...(info?.input_order?.required || []),
    ...(info?.input_order?.optional || []),
    ...Object.keys(info?.input?.required || {}),
    ...Object.keys(info?.input?.optional || {}),
    ...Object.keys(node.inputs),
  ];
  return [...new Set(preferred)].filter((field) =>
    Object.hasOwn(node.inputs, field),
  );
}

function inferInputValueType(
  classType: string,
  field: string,
  spec: ComfyInputSpec | undefined,
  currentValue: unknown,
): ComfyInputValueType {
  const className = classType.toLowerCase();
  const fieldName = field.toLowerCase();
  if (looksLikeMediaLoader(className, fieldName, "image")) return "image";
  if (looksLikeMediaLoader(className, fieldName, "video")) return "video";
  if (looksLikeMediaLoader(className, fieldName, "audio")) return "audio";
  const declared = spec?.[0];
  if (Array.isArray(declared)) return "enum";
  switch (String(declared || "").toUpperCase()) {
    case "STRING":
      return "string";
    case "INT":
      return "integer";
    case "FLOAT":
      return "number";
    case "BOOLEAN":
      return "boolean";
    case "IMAGE":
      return "image";
    case "VIDEO":
      return "video";
    case "AUDIO":
      return "audio";
  }
  if (typeof currentValue === "string") return "string";
  if (typeof currentValue === "boolean") return "boolean";
  if (typeof currentValue === "number")
    return Number.isInteger(currentValue) ? "integer" : "number";
  return "json";
}

function looksLikeMediaLoader(
  className: string,
  fieldName: string,
  media: "image" | "video" | "audio",
) {
  return (
    className.includes(`load${media}`) &&
    (fieldName === media ||
      fieldName.includes(`${media}_file`) ||
      fieldName.includes(`${media}file`))
  );
}

function mapOutputResourceType(comfyType: string): ComfyOutputResourceType {
  const value = comfyType.toUpperCase();
  if (value.includes("IMAGE")) return "image";
  if (value.includes("VIDEO") || value.includes("GIF")) return "video";
  if (value.includes("AUDIO")) return "audio";
  if (value === "STRING" || value === "TEXT") return "text";
  if (value.includes("FILE")) return "file";
  return "json";
}

function inferOutputNodeResource(classType: string): ComfyOutputResourceType {
  const value = classType.toLowerCase();
  if (value.includes("image")) return "image";
  if (
    value.includes("video") ||
    value.includes("gif") ||
    value.includes("webp")
  )
    return "video";
  if (value.includes("audio")) return "audio";
  if (value.includes("text") || value.includes("string")) return "text";
  if (value.includes("file")) return "file";
  return "json";
}

function isSerializableOutput(
  resourceType: ComfyOutputResourceType,
  comfyType: string,
) {
  if (resourceType !== "json") return true;
  const opaque = new Set([
    "MODEL",
    "LATENT",
    "CONDITIONING",
    "CLIP",
    "VAE",
    "CONTROL_NET",
    "SAMPLER",
    "SIGMAS",
  ]);
  return !opaque.has(comfyType.toUpperCase());
}

function compareNodeIds(left: string, right: string) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber))
    return leftNumber - rightNumber;
  return left.localeCompare(right);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
