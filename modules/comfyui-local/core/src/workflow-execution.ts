import type {
  ComfyApiWorkflow,
  ComfyWorkflowDefinition,
} from "../../contracts/src/index.js";

export function materializeComfyWorkflow(
  definition: ComfyWorkflowDefinition,
  values: Record<string, unknown>,
  connectedValues: Record<string, unknown> = {},
): ComfyApiWorkflow {
  const workflow = cloneJson(definition.apiWorkflow);
  for (const input of definition.inputs) {
    const node = workflow[input.nodeId];
    if (!node)
      throw new Error(
        `工作流输入 ${input.label} 对应的节点 #${input.nodeId} 不存在`,
      );
    const hasConnectedValue = Object.hasOwn(connectedValues, input.id);
    const hasEditedValue = Object.hasOwn(values, input.id);
    const value = hasConnectedValue
      ? connectedValues[input.id]
      : hasEditedValue
        ? values[input.id]
        : input.defaultValue;
    if (
      input.required &&
      (value === undefined || value === null || value === "")
    )
      throw new Error(`工作流输入 ${input.label} 不能为空`);
    if (value !== undefined) node.inputs[input.field] = cloneJson(value);
  }
  return workflow;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
