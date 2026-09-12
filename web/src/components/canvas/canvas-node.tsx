import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Boxes, ChevronRight, CircleAlert, FileText, Group, History, Image as ImageIcon, LoaderCircle, Music2, Puzzle, RefreshCw, Star, UploadCloud, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getCanvasNodePorts, type ResolvedCanvasNodePort } from "@/lib/canvas/canvas-node-ports";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { clampCanvasNodeResize } from "@/lib/canvas/canvas-node-size";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeAnchoredPopup } from "./canvas-node-popup";
import { CanvasNodeType, type CanvasImageHistoryEntry, type CanvasNodeData, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useTranslation } from "react-i18next";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#2f80ff";

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    connectionsEnabled?: boolean;
    objectMode?: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target", portId?: string) => void;
    onResizeStart: (nodeId: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onResizeEnd: (nodeId: string) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onSelectImageHistory?: (nodeId: string, historyId: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onShowErrorDetails?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onUpload?: (node: CanvasNodeData) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onShowErrorDetails?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onUpload?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    groupChildCount: number;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    connectionsEnabled = true,
    objectMode = false,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    mentionReferences = [],
    pluginHost,
    registryVersion,
    renderPanel,
    renderNodeContent,
    batchCount = 0,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResizeStart,
    onResize,
    onResizeEnd,
    onContentChange,
    onSelectImageHistory,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onShowErrorDetails,
    onGenerateImage,
    onViewImage,
    onUpload,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [hovered, setHovered] = useState(false);
    const definition = getNodeDefinition(data.type);
    const connectionPorts = useMemo(() => getCanvasNodePorts(data), [data, registryVersion]);
    const inputPorts = connectionPorts.filter((port) => port.direction === "input");
    const outputPorts = connectionPorts.filter((port) => port.direction === "output");
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isGroup = data.type === CanvasNodeType.Group;
    const isNativeWorkbench = data.type === CanvasNodeType.Image || data.type === CanvasNodeType.Video || data.type === CanvasNodeType.Audio || data.type === CanvasNodeType.Text;
    const isUploadMaterial = data.metadata?.sourceOrigin === "upload";
    const hasGlobalSetValue = Boolean(data.metadata?.content || (data.type === CanvasNodeType.Text && data.metadata?.prompt));
    const isGlobalObjectSource = objectMode && Boolean(data.metadata?.canvasSetEnabled) && hasGlobalSetValue && [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(data.type as CanvasNodeType);
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const hasImageHistory = data.type === CanvasNodeType.Image && (data.metadata?.imageHistory?.filter((entry) => Boolean(entry.content)).length || 0) > 1;
    // Nodes with the interaction/move toggle ignore content pointer events in move mode and allow interaction in interactive mode.
    // forceInteractive states such as editing stay interactive, as do empty nodes so their upload and generation actions remain usable.
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    const contentInteractive = !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    // Transparent nodes such as SVGs blend into the canvas while retaining outlines for selected or related states.
    const transparentBg = Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? selectionBlue : isRelated && !isBatchChild ? theme.node.muted : "transparent";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || t("canvas.node.untitled");
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, t, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = resizeRef.current.startWidth + (fromLeft ? -dx : dx);
            const rawHeight = resizeRef.current.startHeight + (fromTop ? -dy : dy);
            const widthDriven = Math.abs(dx) >= Math.abs(dy);
            const ratioWidth = resizeRef.current.keepRatio && !widthDriven ? rawHeight * resizeRef.current.ratio : rawWidth;
            const { width, height } = clampCanvasNodeResize(ratioWidth, rawHeight, resizeRef.current.keepRatio, resizeRef.current.ratio);

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
        onResizeEnd(data.id);
    }, [data.id, handleResizeMove, onResizeEnd]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        onResizeStart(data.id);
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video || Boolean(definition?.keepAspectRatio?.(data)),
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
            if (resizeRef.current.isResizing) onResizeEnd(data.id);
        };
    }, [data.id, handleResizeMove, handleResizeUp, onResizeEnd]);

    return (
        <div
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => onSelectCapture?.(event, data.id)}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            {(isNativeWorkbench || isSelected || hovered || isEditingTitle) && (
                <div
                    className={`absolute z-[65] ${hasImageHistory ? "max-w-[calc(100%-78px)]" : "max-w-[calc(100%-24px)]"} ${isNativeWorkbench ? "left-2 top-[-40px]" : "left-3 top-[-28px]"}`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {isEditingTitle ? (
                        <input
                            ref={titleInputRef}
                            value={titleDraft}
                            maxLength={64}
                            className={`max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left font-semibold outline-none ${isNativeWorkbench ? "h-8 text-base" : "h-6 text-xs"}`}
                            style={{ borderColor: theme.node.muted, color: theme.node.text }}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onBlur={finishTitleEditing}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") finishTitleEditing();
                                if (event.key === "Escape") {
                                    setTitleDraft(data.title || "");
                                    setIsEditingTitle(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className={`max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left font-semibold opacity-75 transition hover:border-current hover:opacity-100 ${isNativeWorkbench ? "flex items-center gap-2 text-base" : "block text-xs"}`}
                            style={{ color: theme.node.text }}
                            title={t("canvas.node.renameHint")}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                setIsEditingTitle(true);
                            }}
                        >
                            {isNativeWorkbench ? nativeNodeTitleIcon(data.type) : null}
                            <span className="truncate">{data.title || t("canvas.node.untitled")}</span>
                            {isUploadMaterial ? (
                                <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium leading-none opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                                    {t("canvas.material.referenceBadge")}
                                </span>
                            ) : null}
                            {isGlobalObjectSource ? <Boxes className="size-3.5 shrink-0 opacity-55" aria-label={t("canvas.objectReferences.setReady")} /> : null}
                        </button>
                    )}
                </div>
            )}

            <div
                className="relative h-full w-full overflow-visible rounded-3xl border-2"
                style={{
                    background: isGroup ? `${theme.toolbar.panel}66` : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                    borderColor: isGroup
                        ? isGroupDropTarget || isActive
                            ? selectionBlue
                            : theme.node.stroke
                        : hasImageContent
                          ? imageBorderColor
                          : isActive
                            ? selectionBlue
                            : isRelated
                              ? theme.node.muted
                              : transparentBg
                                ? "transparent"
                                : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isGroupDropTarget
                        ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10`
                        : isActive
                          ? `0 0 0 1px ${selectionBlue}55`
                          : isRelated && !isBatchChild
                            ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)`
                            : undefined,
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                            pointerEvents: contentInteractive ? undefined : "none",
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        pluginContext={pluginContext}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onShowErrorDetails={onShowErrorDetails}
                        onGenerateImage={onGenerateImage}
                        onUpload={onUpload}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                        groupChildCount={groupChildCount}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}
                {hasImageContent ? <ImageHistoryControl node={data} onSelect={(historyId) => onSelectImageHistory?.(data.id, historyId)} /> : null}

                {!isGroup && !hasImageContent && !hasVideoContent && !hasAudioContent ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} />
                ) : null}

                <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
            </div>

            {connectionsEnabled && !isGroup
                ? inputPorts.map((port, index) => (
                      <ConnectionHandleDot
                          key={`input:${port.id}`}
                          side="left"
                          port={port}
                          index={index}
                          count={inputPorts.length}
                          visible={!port.legacy || hovered || isSelected || isConnecting}
                          onMouseDown={(event) => onConnectStart(event, data.id, "target", port.legacy ? undefined : port.id)}
                      />
                  ))
                : null}
            {connectionsEnabled && !isGroup
                ? outputPorts.map((port, index) => (
                      <ConnectionHandleDot
                          key={`output:${port.id}`}
                          side="right"
                          port={port}
                          index={index}
                          count={outputPorts.length}
                          visible={!port.legacy || hovered || isSelected || isConnecting}
                          onMouseDown={(event) => onConnectStart(event, data.id, "source", port.legacy ? undefined : port.id)}
                      />
                  ))
                : null}

            {showPanel && !isGroup && renderPanel ? (
                <div className="absolute left-1/2 top-full z-[70] -translate-x-1/2 pt-3" style={{ width: isNativeWorkbench ? Math.max(data.width, data.type === CanvasNodeType.Image || data.type === CanvasNodeType.Video ? 760 : data.width) : 600 }}>
                    {renderPanel(data)}
                </div>
            ) : null}
        </div>
    );
});

function nativeNodeTitleIcon(type: CanvasNodeData["type"]) {
    if (type === CanvasNodeType.Image) return <ImageIcon className="size-5 shrink-0" />;
    if (type === CanvasNodeType.Video) return <Video className="size-5 shrink-0" />;
    if (type === CanvasNodeType.Audio) return <Music2 className="size-5 shrink-0" />;
    return <FileText className="size-5 shrink-0" />;
}

function NodeContent(props: NodeContentRendererProps) {
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (shouldShowMediaGenerationGlass(props.node)) return <MediaGeneratingContent {...props} />;
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading") return <LoadingContent theme={props.theme} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onShowErrorDetails={props.onShowErrorDetails} />;

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;

    // Render plugin nodes with their registered renderer, or show the missing-plugin placeholder.
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return <PluginContent ctx={props.pluginContext} />;
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

export function shouldShowMediaGenerationGlass(node: CanvasNodeData) {
    return (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && node.metadata?.status === "loading" && Boolean(node.metadata.content);
}

const nodeContentRenderers: Partial<Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>> = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
};

function GroupNodeContent({ node, theme, groupChildCount }: NodeContentRendererProps) {
    const { t } = useTranslation();
    return (
        <div className="pointer-events-none flex h-full w-full flex-col p-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.node.text }}>
                <span className="grid size-8 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                    <Group className="size-4" />
                </span>
                <span>{t("canvas.node.group")}</span>
                <span className="ml-auto rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    {t("canvas.node.nodeCount", { count: groupChildCount })}
                </span>
            </div>
            <div className="mt-3 flex-1 rounded-2xl border border-dashed" style={{ borderColor: theme.node.stroke, background: `${theme.node.fill}55` }} />
        </div>
    );
}

function LoadingContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] tracking-[0.2em]">{t("canvas.node.generating")}</span>
        </div>
    );
}

function MediaGeneratingContent(props: NodeContentRendererProps) {
    return (
        <div className="relative h-full w-full">
            {props.node.type === CanvasNodeType.Image ? <ImageNodeContent {...props} /> : <VideoNodeContent {...props} />}
            <MediaGenerationGlassOverlay node={props.node} theme={props.theme} />
        </div>
    );
}

export function MediaGenerationGlassOverlay({ node, theme }: Pick<NodeContentRendererProps, "node" | "theme">) {
    const { t } = useTranslation();
    const progress = node.metadata?.providerTask?.progress;
    const percent = typeof progress === "number" && Number.isFinite(progress) ? Math.min(99, Math.max(0, Math.round(progress))) : undefined;
    const isDark = theme.canvas.background === "#0d0d0d";

    return (
        <div
            className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-3xl"
            style={{
                background: isDark ? "rgba(8, 10, 11, .42)" : "rgba(251, 250, 247, .48)",
                backdropFilter: "blur(18px) saturate(.78) brightness(.82)",
                WebkitBackdropFilter: "blur(18px) saturate(.78) brightness(.82)",
                boxShadow: `inset 0 0 0 1px ${isDark ? "rgba(255,255,255,.1)" : "rgba(41,37,36,.08)"}, inset 0 22px 52px rgba(0,0,0,.08)`,
            }}
            data-canvas-media-generation-glass
            aria-live="polite"
            aria-label={percent === undefined ? t("canvas.node.generating") : `${t("canvas.node.generating")} ${percent}%`}
        >
            <div
                className="relative z-10 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-medium tracking-[0.08em] shadow-[0_10px_28px_rgba(0,0,0,.16)] backdrop-blur-md"
                style={{ background: isDark ? "rgba(19,22,23,.55)" : "rgba(255,255,255,.55)", borderColor: isDark ? "rgba(255,255,255,.13)" : "rgba(41,37,36,.1)", color: theme.node.text }}
            >
                <LoaderCircle className="size-3.5 animate-spin" style={{ color: theme.node.activeStroke }} />
                <span>{t("canvas.node.generating")}</span>
                {percent !== undefined ? <span className="tabular-nums opacity-65">{percent}%</span> : null}
            </div>
        </div>
    );
}

function ErrorContent({ node, theme, onRetry, onShowErrorDetails }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry" | "onShowErrorDetails">) {
    const { t } = useTranslation();
    const summary = node.metadata?.providerTask?.message || node.metadata?.errorDetails?.split(/\r?\n/).find((line) => line.trim()) || t("canvas.node.failed");
    return (
        <div className="flex max-w-[300px] flex-col items-center gap-3 px-5 text-center">
            <CircleAlert className="size-6 text-red-400" />
            <div className="line-clamp-3 text-xs leading-5 text-red-300">{summary}</div>
            <div className="flex items-center gap-2">
                {node.metadata?.errorDetails && onShowErrorDetails ? (
                    <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onShowErrorDetails(node);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        {t("canvas.node.viewErrorDetails")}
                    </button>
                ) : null}
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRetry?.(node);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <RefreshCw className="size-3.5" />
                    {t("canvas.node.retry")}
                </button>
            </div>
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">{t("canvas.node.missingPlugin")}</span>
            <span className="text-[11px] opacity-70">{t("canvas.node.missingPluginDescription", { type })}</span>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing, onGenerateImage }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-8">
            <button
                type="button"
                className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium opacity-85 backdrop-blur-md transition hover:scale-[1.02] hover:opacity-100"
                style={{ background: `${theme.toolbar.panel}dd`, borderColor: theme.node.stroke, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={t("canvas.node.generateImage")}
                aria-label={t("canvas.node.generateImage")}
            >
                <ImageIcon className="size-3.5" />
                {t("canvas.node.generate")}
            </button>
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent pl-4 pr-14 pt-0 pb-4 m-0 font-mono outline-none select-text appearance-none"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : (
                <div className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent pl-4 pr-14 pt-0 pb-4 font-mono" style={textStyle} onWheel={(event) => event.stopPropagation()}>
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>{t("canvas.node.editText")}</span>}
                </div>
            )}
        </div>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent theme={props.theme} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onShowErrorDetails={props.onShowErrorDetails} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
        />
    );
}

function EmptyImageContent({ node, theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, onUpload }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (node.metadata?.sourceOrigin === "upload") {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-6 text-center" style={{ color: theme.node.muted }}>
                <div className="grid size-16 place-items-center rounded-2xl border border-dashed" style={{ borderColor: theme.node.stroke, background: `${theme.toolbar.activeBg}66` }}>
                    <UploadCloud className="size-7 opacity-65" />
                </div>
                <div className="text-sm font-semibold" style={{ color: theme.node.text }}>
                    {t("canvas.material.uploadTitle")}
                </div>
                <div className="max-w-72 text-[11px] leading-4 opacity-60">{t("canvas.material.uploadDescription")}</div>
                <button
                    type="button"
                    className="mt-1 h-9 rounded-full border px-4 text-xs font-medium transition-colors duration-150 hover:bg-white/5"
                    style={{ borderColor: theme.toolbar.border, color: theme.node.text }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onUpload?.(node);
                    }}
                    data-canvas-no-zoom
                >
                    {t("canvas.material.chooseFile")}
                </button>
            </div>
        );
    }
    const content = <EmptyMediaContent node={node} theme={theme} icon={<ImageIcon className="size-9 opacity-35" />} label={t("canvas.node.emptyImage")} onUpload={onUpload} />;
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function VideoNodeContent({ node, theme, onUpload }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content) return <EmptyMediaContent node={node} theme={theme} icon={<Video className="size-9 opacity-35" />} label={t("canvas.node.emptyVideo")} onUpload={onUpload} />;
    return <video src={node.metadata.content} controls className="h-full w-full rounded-[18px] bg-black object-cover" data-canvas-no-zoom />;
}

function EmptyMediaContent({ node, theme, icon, label, onUpload }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: ReactNode; label: string; onUpload?: (node: CanvasNodeData) => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-20 items-center justify-center rounded-[22px] border" style={{ background: `${theme.toolbar.activeBg}88`, borderColor: theme.node.stroke }}>
                {icon}
            </div>
            <span className="text-[11px] tracking-[0.12em] opacity-50">{label}</span>
            <div className="pointer-events-auto flex items-center gap-2" data-canvas-no-zoom>
                <button
                    type="button"
                    className="h-8 rounded-full border px-3 text-[11px] font-medium transition-colors duration-150 hover:bg-white/5"
                    style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onUpload?.(node);
                    }}
                >
                    {t("canvas.material.chooseFile")}
                </button>
                <span className="text-[10px] opacity-45">{t("canvas.node.selectToGenerate")}</span>
            </div>
        </div>
    );
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">{t("canvas.node.emptyAudio")}</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{t("canvas.node.audio")}</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    node,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
}: {
    node: CanvasNodeData;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const isBatchChild = Boolean(node.metadata?.batchRootId);

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
            <div className="h-full w-full overflow-hidden rounded-3xl">
                <img
                    key={node.metadata!.content!}
                    src={node.metadata!.content!}
                    alt={node.title}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    className="td-canvas-image-version-in pointer-events-none block h-full w-full select-none object-cover"
                />
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold shadow-[0_6px_18px_rgba(15,23,42,.10)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: `${theme.toolbar.panel}d9`, borderColor: `${theme.toolbar.border}cc`, color: theme.node.text }}
                    aria-label={batchExpanded ? t("canvas.node.batchExpanded") : t("canvas.node.batchCollapsed")}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none text-[#2f80ff]">{batchCount}</span>
                    <ChevronRight className={`size-3.5 opacity-55 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            {isBatchChild ? (
                <button
                    type="button"
                    className="absolute right-3 top-3 z-30 flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium opacity-0 shadow-[0_8px_20px_rgba(68,64,60,.13)] backdrop-blur-md transition group-hover/batch:opacity-100 hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5 text-[#2f80ff]" />
                    {t("canvas.node.setPrimary")}
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ImageHistoryControl({ node, onSelect }: { node: CanvasNodeData; onSelect?: (historyId: string) => void }) {
    const { t } = useTranslation();
    const history = node.metadata?.imageHistory?.filter((entry) => Boolean(entry.content)) || [];
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const activeId = node.metadata?.activeImageHistoryId || history.find((entry) => entry.content === node.metadata?.content)?.id || history.at(-1)?.id;
    const disabled = node.metadata?.status === "loading";

    useEffect(() => {
        if (!open) return;
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [open]);

    useEffect(() => {
        if (history.length < 2) setOpen(false);
    }, [history.length]);

    useEffect(() => {
        const root = document.documentElement;
        const attribute = "data-tdcanvas-image-history-open";
        if (open) root.setAttribute(attribute, node.id);
        else if (root.getAttribute(attribute) === node.id) root.removeAttribute(attribute);
        return () => {
            if (root.getAttribute(attribute) === node.id) root.removeAttribute(attribute);
        };
    }, [node.id, open]);

    if (history.length < 2) return null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={`absolute right-2 top-[-39px] z-[68] flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium shadow-[0_8px_24px_rgba(0,0,0,.18)] backdrop-blur-xl transition duration-150 hover:-translate-y-px ${open ? "border-[#2f80ff]/70 text-white" : "border-white/12 text-white/72 hover:border-white/25 hover:text-white"}`}
                style={{ background: open ? "rgba(31,66,118,.82)" : "rgba(14,16,18,.82)" }}
                title={t("canvas.node.imageHistory")}
                aria-label={t("canvas.node.openImageHistory", { count: history.length })}
                aria-expanded={open}
                data-canvas-image-history-trigger
                data-canvas-no-zoom
                onClick={(event) => {
                    event.stopPropagation();
                    setOpen((value) => !value);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <History className="size-3.5" />
                <span className="tabular-nums">{history.length}</span>
                <ChevronRight className={`size-3 opacity-55 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
            </button>

            <CanvasNodeAnchoredPopup open={open} anchorRef={triggerRef} panelRef={panelRef} placement="topRight" width={330} maxHeight={420} gap={8} flipVertical>
                <ImageHistoryPanel history={history} activeId={activeId} disabled={disabled} onSelect={onSelect} onClose={() => setOpen(false)} />
            </CanvasNodeAnchoredPopup>
        </>
    );
}

function ImageHistoryPanel({ history, activeId, disabled, onSelect, onClose }: { history: CanvasImageHistoryEntry[]; activeId?: string; disabled: boolean; onSelect?: (historyId: string) => void; onClose: () => void }) {
    const { t } = useTranslation();
    return (
        <div
            className="td-canvas-image-history-panel flex max-h-[inherit] flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#111416]/96 p-3 text-white shadow-[0_24px_64px_rgba(0,0,0,.42)] backdrop-blur-2xl"
            data-canvas-image-history
            data-canvas-no-zoom
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="flex shrink-0 items-start justify-between gap-4 px-1 pb-3">
                <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-white/92">{t("canvas.node.imageHistory")}</div>
                    <div className="mt-0.5 text-[10px] leading-4 text-white/42">{t("canvas.node.imageHistoryHint")}</div>
                </div>
                <span className="mt-0.5 rounded-full bg-white/7 px-2 py-1 text-[10px] tabular-nums text-white/55">{history.length}</span>
            </div>
            <div className="thin-scrollbar grid min-h-0 grid-cols-3 gap-2 overflow-y-auto pr-0.5" role="listbox" aria-label={t("canvas.node.imageHistory")}>
                {history.map((entry, index) => {
                    const active = entry.id === activeId;
                    const label = t("canvas.node.imageHistoryVersion", { index: index + 1 });
                    return (
                        <button
                            key={entry.id}
                            type="button"
                            className={`group/version relative aspect-[4/3] min-w-0 overflow-hidden rounded-xl border bg-black/35 text-left transition duration-180 ${active ? "border-[#4b94ff] shadow-[0_0_0_2px_rgba(47,128,255,.32)]" : "border-white/10 opacity-72 hover:-translate-y-0.5 hover:border-white/32 hover:opacity-100"}`}
                            aria-label={active ? t("canvas.node.imageHistoryCurrent", { index: index + 1 }) : label}
                            aria-selected={active}
                            disabled={disabled}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (!active) onSelect?.(entry.id);
                                onClose();
                            }}
                            title={label}
                        >
                            <img src={entry.content} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover transition duration-200 group-hover/version:scale-[1.035]" />
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/82 via-black/46 to-transparent px-2 pb-1.5 pt-5 text-[9px] font-semibold leading-none text-white/86">
                                <span>V{index + 1}</span>
                                {active ? <span className="text-[#77aaff]">{t("canvas.node.imageHistoryActive")}</span> : null}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; onToggleBatch?: () => void; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_14px_34px_rgba(68,64,60,.16)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, port, index, count, visible, onMouseDown }: { side: "left" | "right"; port: ResolvedCanvasNodePort; index: number; count: number; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`absolute z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "-left-6" : "-right-6"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            style={{ top: `${((index + 1) / (count + 1)) * 100}%` }}
            title={port.description || `${port.label} · ${port.dataType}`}
            data-port-id={port.legacy ? undefined : port.id}
            data-port-direction={port.direction}
            data-port-type={port.dataType}
            onMouseDown={onMouseDown}
        >
            <div className="size-3 rounded-full border-2 transition-all hover:scale-125" style={{ background: theme.node.panel, borderColor: port.color || theme.node.muted }} />
            {!port.legacy ? (
                <span className={`pointer-events-none absolute max-w-28 truncate text-[10px] font-medium ${side === "left" ? "left-8 text-left" : "right-8 text-right"}`} style={{ color: theme.node.muted }}>
                    {port.label}
                </span>
            ) : null}
        </div>
    );
}
