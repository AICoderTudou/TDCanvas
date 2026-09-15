export type ComfyApiNodeId = string;
export type ComfyApiLink = [nodeId: string | number, outputIndex: number];

export type ComfyApiNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string; [key: string]: unknown };
};

export type ComfyApiWorkflow = Record<ComfyApiNodeId, ComfyApiNode>;

export type ComfyInputOptions = {
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  multiline?: boolean;
  tooltip?: string;
  label?: string;
  forceInput?: boolean;
  defaultInput?: boolean;
  [key: string]: unknown;
};

export type ComfyInputSpec = [
  type: string | string[],
  options?: ComfyInputOptions,
];

export type ComfyObjectInfoNode = {
  name?: string;
  display_name?: string;
  description?: string;
  category?: string;
  python_module?: string;
  input?: {
    required?: Record<string, ComfyInputSpec>;
    optional?: Record<string, ComfyInputSpec>;
    hidden?: Record<string, unknown>;
  };
  input_order?: Record<string, string[]>;
  output?: string[];
  output_name?: string[];
  output_is_list?: boolean[];
  output_node?: boolean;
  deprecated?: boolean;
  experimental?: boolean;
  [key: string]: unknown;
};

export type ComfyObjectInfo = Record<string, ComfyObjectInfoNode>;

export type ComfyInputValueType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "enum"
  | "image"
  | "video"
  | "audio"
  | "json";
export type ComfyOutputResourceType =
  | "image"
  | "video"
  | "audio"
  | "text"
  | "file"
  | "json";

export type ComfyInspectedInput = {
  id: string;
  nodeId: string;
  classType: string;
  nodeTitle: string;
  field: string;
  label: string;
  section: "required" | "optional" | "unknown";
  currentValue: unknown;
  valueType: ComfyInputValueType;
  internalLink: boolean;
  exposable: boolean;
  recommended: boolean;
  options: ComfyInputOptions;
  enumValues?: string[];
};

export type ComfyInspectedOutput = {
  id: string;
  nodeId: string;
  classType: string;
  nodeTitle: string;
  outputIndex?: number;
  outputName: string;
  comfyType?: string;
  resourceType: ComfyOutputResourceType;
  outputNode: boolean;
  exposable: boolean;
};

export type ComfyInspectedNode = {
  nodeId: string;
  classType: string;
  title: string;
  category?: string;
  pythonModule?: string;
  missing: boolean;
  inputs: ComfyInspectedInput[];
  outputs: ComfyInspectedOutput[];
};

export type ComfyWorkflowInspection = {
  workflow: ComfyApiWorkflow;
  nodes: ComfyInspectedNode[];
  inputs: ComfyInspectedInput[];
  outputs: ComfyInspectedOutput[];
  missingClassTypes: string[];
  runnable: boolean;
};

export type ComfyInstallKind =
  | "windows-portable"
  | "source-venv"
  | "source-system-python";

export type ComfyEnvironmentProfile = {
  id: string;
  name: string;
  rootDirectory: string;
  mainPyPath: string;
  pythonPath: string;
  installKind: ComfyInstallKind;
  extraArgs: string[];
  lastPort?: number;
};

export type ComfyEnvironmentDetection = {
  profile?: ComfyEnvironmentProfile;
  selectedRoot: string;
  pythonCandidates: string[];
  issues: string[];
  ready: boolean;
};

export type ComfySavedEnvironments = {
  profiles: ComfyEnvironmentProfile[];
  activeProfileId?: string;
};

export type ComfyEnvironmentPhase =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "failed";

export type ComfyEnvironmentStatus = {
  phase: ComfyEnvironmentPhase;
  pid?: number;
  port?: number;
  startedAt?: number;
  message?: string;
  profileId?: string;
};

export type ComfyEnvironmentLogEntry = {
  timestamp: number;
  stream: "stdout" | "stderr" | string;
  message: string;
};

export type ComfyEnvironmentLaunchResult = {
  status: ComfyEnvironmentStatus;
  executable: string;
  args: string[];
};

export type ComfyInputControl =
  | "text"
  | "textarea"
  | "number"
  | "slider"
  | "switch"
  | "select"
  | "media"
  | "json";

export type ComfyExposedInput = {
  id: string;
  nodeId: string;
  field: string;
  label: string;
  valueType: ComfyInputValueType;
  control: ComfyInputControl;
  defaultValue: unknown;
  required: boolean;
  canvasPort: boolean;
  bypassWhenDisconnected?: boolean;
  bypassNodeIds?: string[];
  constraints?: Record<string, unknown>;
  enumValues?: string[];
};

export type ComfyExposedOutput = {
  id: string;
  nodeId: string;
  outputIndex?: number;
  resultField?: string;
  label: string;
  resourceType: ComfyOutputResourceType;
  canvasPort: boolean;
  preview: boolean;
};

export type ComfyDependencySnapshot = {
  nodeCount: number;
  classTypes: string[];
  customNodeCount: number;
  missingClassTypes: string[];
  runnable: boolean;
  verifiedAt: string;
};

export type ComfyWorkflowDefinition = {
  id: string;
  name: string;
  description?: string;
  environmentId: string;
  apiWorkflow: ComfyApiWorkflow;
  workflowHash: string;
  inputs: ComfyExposedInput[];
  outputs: ComfyExposedOutput[];
  dependencySnapshot: ComfyDependencySnapshot;
  createdAt: string;
  updatedAt: string;
};

export type ComfyUploadedInput = {
  name: string;
  subfolder?: string;
  type?: string;
};

export type ComfyQueuedPrompt = {
  promptId: string;
  queueNumber?: number;
  nodeErrors?: Record<string, unknown>;
};

export type ComfyRequestedOutput = Pick<
  ComfyExposedOutput,
  "id" | "nodeId" | "resultField" | "label" | "resourceType"
>;

export type ComfyExecutionOutput = {
  outputId: string;
  nodeId: string;
  itemIndex: number;
  resourceType: ComfyOutputResourceType;
  label: string;
  filename?: string;
  mimeType?: string;
  absolutePath?: string;
  bytes?: number;
  text?: string;
  raw?: unknown;
};

export type ComfyExecutionResult = {
  promptId: string;
  outputs: ComfyExecutionOutput[];
  completedAt: number;
};
