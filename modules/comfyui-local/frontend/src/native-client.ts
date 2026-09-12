import type {
  ComfyEnvironmentDetection,
  ComfyEnvironmentLaunchResult,
  ComfyEnvironmentLogEntry,
  ComfySavedEnvironments,
  ComfyEnvironmentStatus,
  ComfyObjectInfo,
  ComfyApiWorkflow,
  ComfyExecutionResult,
  ComfyQueuedPrompt,
  ComfyRequestedOutput,
  ComfyUploadedInput,
} from "../../contracts/src/index.js";

export type ComfyNativeInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

const command = (name: string) => `plugin:tdcanvas-comfyui-local|${name}`;

export function createComfyNativeClient(invoke: ComfyNativeInvoke) {
  return {
    selectEnvironment: () =>
      invoke<ComfyEnvironmentDetection | null>(command("select_environment")),
    selectEnvironmentPython: () =>
      invoke<ComfyEnvironmentDetection | null>(
        command("select_environment_python"),
      ),
    savedEnvironments: () =>
      invoke<ComfySavedEnvironments>(command("saved_environments")),
    removeEnvironment: (profileId: string) =>
      invoke<ComfySavedEnvironments>(command("remove_environment"), {
        profileId,
      }),
    startEnvironment: (profileId: string) =>
      invoke<ComfyEnvironmentLaunchResult>(command("start_environment"), {
        profileId,
      }),
    stopEnvironment: () =>
      invoke<ComfyEnvironmentStatus>(command("stop_environment")),
    status: () => invoke<ComfyEnvironmentStatus>(command("environment_status")),
    logs: () => invoke<ComfyEnvironmentLogEntry[]>(command("environment_logs")),
    systemStats: () => invoke<Record<string, unknown>>(command("system_stats")),
    objectInfo: () => invoke<ComfyObjectInfo>(command("object_info")),
    uploadInput: (
      profileId: string,
      filename: string,
      mimeType: string,
      bytes: number[],
    ) =>
      invoke<ComfyUploadedInput>(command("upload_input"), {
        profileId,
        filename,
        mimeType,
        bytes,
      }),
    queueWorkflow: (profileId: string, workflow: ComfyApiWorkflow) =>
      invoke<ComfyQueuedPrompt>(command("queue_workflow"), {
        profileId,
        workflow,
      }),
    waitForExecution: (
      profileId: string,
      promptId: string,
      outputs: ComfyRequestedOutput[],
    ) =>
      invoke<ComfyExecutionResult>(command("wait_for_execution"), {
        profileId,
        promptId,
        outputs,
      }),
    interruptExecution: (profileId: string, promptId: string) =>
      invoke<void>(command("interrupt_execution"), { profileId, promptId }),
  };
}

export type ComfyNativeClient = ReturnType<typeof createComfyNativeClient>;
