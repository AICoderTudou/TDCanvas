import type { ComponentType, ReactNode } from "react";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata, CanvasNodePort } from "@/types/canvas";
import type { CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";

// Resource emitted when a plugin node is consumed as an upstream input.
export type CanvasNodeResource = { kind: CanvasResourceKind; text?: string; url?: string; name?: string; mimeType?: string; storageKey?: string; localPath?: string };

// AI generation capabilities injected by the host, reusing its model and credential configuration.
export type GenerateOptions = { signal?: AbortSignal; references?: string[]; model?: string };
export type GenerateImageOptions = GenerateOptions & { count?: number; size?: string };
export type GenerateImageResult = { images: string[] };
export type GenerateVideoOptions = GenerateOptions & { size?: string; seconds?: string };
export type GenerateVideoResult = { url: string; mimeType: string; width?: number; height?: number; durationMs?: number };
export type GenerateTextOptions = { signal?: AbortSignal; model?: string; system?: string; onDelta?: (text: string) => void };
export type GenerateTextResult = { text: string };
export type PluginModelCapability = "image" | "video" | "text" | "audio";
export type ModelOption = { value: string; label: string };

export type CanvasPluginAi = {
    generateImage: (prompt: string, options?: GenerateImageOptions) => Promise<GenerateImageResult>;
    generateVideo: (prompt: string, options?: GenerateVideoOptions) => Promise<GenerateVideoResult>;
    generateText: (prompt: string, options?: GenerateTextOptions) => Promise<GenerateTextResult>;
    listModels: (capability?: PluginModelCapability) => ModelOption[];
    defaultModel: (capability: PluginModelCapability) => string;
};

// Node-specific buttons appended to the hover toolbar.
export type CanvasNodeToolbarItem = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

// Context injected while rendering each node; the primary interface between plugins and the canvas.
export type CanvasNodeContext = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    scale: number;
    isSelected: boolean; // Whether this node is selected, used to enable iframe interaction on demand.
    // Node data.
    updateMetadata: (patch: CanvasNodeMetadata) => void;
    updateNode: (patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    // Graph access.
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getInputConnections: (portId?: string) => CanvasConnection[];
    getOutputConnections: (portId?: string) => CanvasConnection[];
    getUpstream: (portId?: string) => CanvasNodeData[];
    getDownstream: (portId?: string) => CanvasNodeData[];
    // Canvas operations using the Agent instruction set for nodes, connections, selection, viewport, and generation.
    applyOps: (ops: CanvasAgentOp[]) => void;
    // Inter-node and inter-plugin communication.
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    // AI image, video, and text generation using the host model configuration.
    ai: CanvasPluginAi;
    // Opens or closes the custom panel below this node; the definition must provide a Panel.
    openPanel: () => void;
    closePanel: () => void;
    // Plugin-private persistence isolated by namespace.
    storage: PluginStorage;
};

export type PluginStorage = {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
};

// Node-independent host capabilities constructed by the canvas page and injected into the render chain.
export type CanvasPluginHost = {
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getInputConnections: (nodeId: string, portId?: string) => CanvasConnection[];
    getOutputConnections: (nodeId: string, portId?: string) => CanvasConnection[];
    getUpstream: (nodeId: string, portId?: string) => CanvasNodeData[];
    getDownstream: (nodeId: string, portId?: string) => CanvasNodeData[];
    updateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    updateMetadata: (nodeId: string, patch: CanvasNodeMetadata) => void;
    applyOps: (ops: CanvasAgentOp[]) => void;
    // AI generation using the current canvas model and credential configuration.
    ai: CanvasPluginAi;
    // Opens or closes the custom panel below a specified node.
    openPanel: (nodeId: string) => void;
    closePanel: () => void;
};

// Configuration for reusing the host's built-in generation panel; see SDK CanvasBuiltinPanelConfig.
export type CanvasBuiltinPanelConfig = {
    mode: "image" | "video" | "text" | "audio";
    promptPrefix?: string;
    writeBackToSelf?: boolean;
};

// Shared node definition used by both built-in and plugin nodes.
export type CanvasNodeDefinition = {
    type: string; // Built-ins use values such as "image"; plugins should use "<pluginId>:<name>".
    title: string;
    icon: ReactNode;
    description?: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    minimapColor?: string;
    showInCreateMenu?: boolean; // Defaults to true.
    createMenuPlacement?: "primary" | "extension"; // Plugins may opt into the same creation group as built-in media nodes.
    hasSourceHandle?: boolean; // Right-side output handle; defaults to true.
    // Named, typed ports. A function supports workflow-defined nodes whose ports live in metadata.
    // When omitted, the host preserves the legacy single input/output handles.
    ports?: CanvasNodePort[] | ((node: CanvasNodeData) => CanvasNodePort[]);
    hidePanel?: boolean; // Prevents click/create from opening a lower panel; intended for display-only nodes.
    transparentBackground?: boolean; // Makes the node card transparent so SVG or vector content blends into the canvas.
    autoOpenPanel?: boolean; // Opens a custom Panel on click; automatic opening otherwise applies only to built-ins.
    useBuiltinPanel?: CanvasBuiltinPanelConfig; // Reuses the built-in generation panel instead of a custom Panel.
    // Lets the host provide an Interaction/Move toolbar toggle and control pointer events through metadata.interactive.
    interactionToggle?: boolean;
    // With interactionToggle, true forces interactive content, ignores metadata.interactive, and hides the toggle.
    forceInteractive?: (node: CanvasNodeData) => boolean;
    keepAspectRatio?: (node: CanvasNodeData) => boolean;
    resource?: (node: CanvasNodeData, outputPortId?: string) => CanvasNodeResource | null;
    // Built-ins use canvas-node's internal renderer and may omit Content.
    Content?: ComponentType<{ ctx: CanvasNodeContext }>;
    Panel?: ComponentType<{ ctx: CanvasNodeContext; onClose: () => void }>;
    toolbar?: (ctx: CanvasNodeContext) => CanvasNodeToolbarItem[];
    onDoubleClick?: (ctx: CanvasNodeContext) => boolean; // Return true when handled.
};

// Application capabilities available while a plugin starts.
export type CanvasPluginApp = {
    version: string;
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    // Injects plugin styles and returns a cleanup function; the same key replaces previous styles.
    injectCSS: (css: string, key?: string) => () => void;
};

// Default plugin package export.
export type CanvasPlugin = {
    id: string;
    name: string;
    version: string;
    description?: string;
    minAppVersion?: string;
    css?: string; // Injected when enabled and removed when uninstalled or disabled.
    nodes: CanvasNodeDefinition[];
    setup?: (app: CanvasPluginApp) => void | (() => void);
};
