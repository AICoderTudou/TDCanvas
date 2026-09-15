import type {
  ComfyApiWorkflow,
  ComfyWorkflowDefinition,
} from "../../contracts/src/index.js";

export function materializeComfyWorkflow(
  definition: ComfyWorkflowDefinition,
  values: Record<string, unknown>,
  connectedValues: Record<string, unknown> = {},
  disabledInputIds: ReadonlySet<string> = new Set(),
): ComfyApiWorkflow {
  const workflow = cloneJson(definition.apiWorkflow);
  const inputsByNode = new Map<string, typeof definition.inputs>();
  for (const input of definition.inputs) {
    const inputs = inputsByNode.get(input.nodeId) || [];
    inputs.push(input);
    inputsByNode.set(input.nodeId, inputs);
  }
  const bypassedInputs = [...inputsByNode.entries()]
      .filter(([, inputs]) => {
        const manuallyDisabled = inputs.some((input) => disabledInputIds.has(input.id));
        return manuallyDisabled || inputs.every((input) => input.bypassWhenDisconnected && !Object.hasOwn(connectedValues, input.id));
      });
  const bypassedNodeIds = new Set(bypassedInputs.flatMap(([nodeId, inputs]) => inputs.flatMap((input) => input.bypassNodeIds?.length ? input.bypassNodeIds : [nodeId])));
  const safePrunedNodeIds = new Set(bypassedInputs.flatMap(([, inputs]) => inputs.flatMap((input) => input.bypassNodeIds || [])));
  for (const input of definition.inputs) {
    if (bypassedNodeIds.has(input.nodeId)) continue;
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
  if (safePrunedNodeIds.size) pruneWorkflowNodes(workflow, safePrunedNodeIds);
  for (const nodeId of bypassedNodeIds) {
    if (safePrunedNodeIds.has(nodeId)) continue;
    const nodeInputs = inputsByNode.get(nodeId) || [];
    const input = nodeInputs.find((candidate) => disabledInputIds.has(candidate.id)) || nodeInputs[0];
    const canDropDangling = nodeInputs.length > 0 && nodeInputs.every((candidate) => Boolean(candidate.bypassWhenDisconnected));
    bypassWorkflowNode(workflow, nodeId, canDropDangling, input?.label);
  }
  return workflow;
}

function pruneWorkflowNodes(workflow: ComfyApiWorkflow, nodeIds: ReadonlySet<string>) {
  for (const [currentNodeId, node] of Object.entries(workflow)) {
    if (nodeIds.has(currentNodeId)) continue;
    for (const [field, value] of Object.entries(node.inputs)) {
      if (isComfyLink(value) && nodeIds.has(String(value[0]))) delete node.inputs[field];
    }
  }
  for (const nodeId of nodeIds) delete workflow[nodeId];
}

function bypassWorkflowNode(workflow: ComfyApiWorkflow, nodeId: string, canDropDangling: boolean, label?: string) {
  const node = workflow[nodeId];
  if (!node) return;
  const upstreamLinks = Object.values(node.inputs).filter(isComfyLink);
  const uniqueUpstreamLinks = [...new Map(upstreamLinks.map((link) => [`${link[0]}:${link[1]}`, link])).values()];
  const replacement = uniqueUpstreamLinks.length === 1 ? uniqueUpstreamLinks[0] : undefined;
  let hasConsumer = false;
  for (const node of Object.values(workflow)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      if (!isComfyLink(value) || String(value[0]) !== nodeId) continue;
      hasConsumer = true;
      if (replacement) node.inputs[field] = cloneJson(replacement);
      else if (canDropDangling) delete node.inputs[field];
      else throw new Error(`输入 ${label || `#${nodeId}`} 没有可接续的上游，无法旁路。请保持开启，或在 ComfyUI 工作流中把它改为可选分支。`);
    }
  }
  if (!hasConsumer || replacement || canDropDangling) delete workflow[nodeId];
}

function isComfyLink(value: unknown): value is [string | number, number] {
  return Array.isArray(value) && value.length === 2 && (typeof value[0] === "string" || typeof value[0] === "number") && typeof value[1] === "number";
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
