import { createComfyNativeClient } from "../../../../modules/comfyui-local/frontend/src/index";
export { buildComfyWorkflowDefinition, comfyInputControl, comfyOutputLabel, comfyWorkflowHash, inspectComfyWorkflow, materializeComfyWorkflow, parseComfyApiWorkflow, ComfyWorkflowParseError } from "../../../../modules/comfyui-local/core/src/index";
import { invokeDesktop } from "@/services/platform/desktop-runtime";

export const comfyNativeClient = createComfyNativeClient(invokeDesktop);

export type * from "../../../../modules/comfyui-local/contracts/src/index";
