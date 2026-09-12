export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Aitudou = "aitudou",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasInputMode = "connections" | "objects";

// A node result is a canvas-scoped object source. Consumers keep this stable
// reference instead of copying media data or depending on the node position.
export type CanvasObjectReference = {
    id: string;
    sourceNodeId: string;
    outputPortId?: string;
    targetInputId?: string;
    versionMode?: "latest" | "pinned";
    versionId?: string;
    createdAt?: string;
};

export type AitudouProviderTaskPhase = "idle" | "queued" | "running" | "succeeded" | "partial" | "failed" | "attention" | "stopped";

export type AitudouProviderTask = {
    provider: "aitudou";
    taskId?: string;
    taskIds?: string[];
    action?: string;
    family?: "video" | "image" | "audio" | "midjourney" | "music";
    phase?: AitudouProviderTaskPhase;
    status?: string;
    progress?: number;
    pollPath?: string;
    pollPaths?: string[];
    message?: string;
    submittedAt?: string;
    completedAt?: string;
    raw?: unknown;
};

export type AitudouProviderButton = {
    customId?: string;
    action?: string;
    label?: string;
    emoji?: string;
    disabled?: boolean;
    raw?: unknown;
};

export type AitudouProviderOutput = {
    kind: "image" | "video" | "audio" | "text" | "file";
    url?: string;
    sourceUrl?: string;
    localPath?: string;
    text?: string;
    name?: string;
    filename?: string;
    mimeType?: string;
    taskId?: string;
    audioIndex?: number;
    selectionIndex?: number;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    persistenceError?: string;
    metadata?: Record<string, unknown>;
};

export type AitudouProviderResult = {
    taskId?: string;
    taskIds?: string[];
    resultUrl?: string;
    lastFrameUrl?: string;
    gridImageUrl?: string;
    urls?: string[];
    outputs?: AitudouProviderOutput[];
    buttons?: AitudouProviderButton[];
    expiresAt?: string;
    raw?: unknown;
};

export type CanvasImageHistoryEntry = {
    id: string;
    content: string;
    sourceUrl?: string;
    storageKey?: string;
    localPath?: string;
    filename?: string;
    mimeType?: string;
    bytes?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    taskId?: string;
    createdAt: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    localPath?: string;
    filename?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    sourceOrigin?: "upload" | "asset" | "generated";
    groupId?: string;
    aitudouOperation?: string;
    aitudouPayload?: string;
    channelId?: string;
    providerTask?: AitudouProviderTask;
    providerResult?: AitudouProviderResult;
    imageHistory?: CanvasImageHistoryEntry[];
    activeImageHistoryId?: string;
    canvasSetEnabled?: boolean;
    objectReferences?: CanvasObjectReference[];
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    [key: string]: unknown;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasPortDirection = "input" | "output";
export type CanvasPortDataType = "any" | "image" | "video" | "audio" | "text" | "number" | "boolean" | "json" | (string & {});

export type CanvasNodePort = {
    id: string;
    label: string;
    direction: CanvasPortDirection;
    dataType: CanvasPortDataType;
    required?: boolean;
    multiple?: boolean; // Input ports default to one incoming connection; true allows multiple.
    description?: string;
    color?: string;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    fromPortId?: string;
    toPortId?: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    portId?: string;
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "canvas";
          x: number;
          y: number;
          world: Position;
      }
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
