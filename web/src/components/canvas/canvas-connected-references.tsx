import { Boxes, FileText, GripVertical, Image as ImageIcon, Music2, Play, Video, X } from "lucide-react";
import { useState, type CSSProperties, type DragEvent } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasResourceKind, CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasConnectedReferencesProps = {
    references: CanvasResourceReference[];
    currentNodeId?: string;
    className?: string;
    fillHeight?: boolean;
    usedReferenceCounts?: Partial<Record<CanvasResourceKind, number>>;
    onFocusNode?: (nodeId: string) => void;
    onDisconnect?: (connectionId: string) => void;
    onReorder?: (sourceConnectionId: string, targetConnectionId: string) => void;
    onRemoveReference?: (reference: CanvasResourceReference) => void;
    onReorderReference?: (source: CanvasResourceReference, target: CanvasResourceReference) => void;
};

export function CanvasConnectedReferences({ references, currentNodeId, className = "", fillHeight = false, usedReferenceCounts, onFocusNode, onDisconnect, onReorder, onRemoveReference, onReorderReference }: CanvasConnectedReferencesProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draggingReferenceId, setDraggingReferenceId] = useState<string | null>(null);
    const [dropTargetReferenceId, setDropTargetReferenceId] = useState<string | null>(null);
    const connected = references.filter((reference) => reference.active && reference.nodeId !== currentNodeId);
    const kindIndexes: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };

    if (!connected.length) return null;

    return (
        <div className={`thin-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 ${fillHeight ? "h-full" : ""} ${className}`} role="list" aria-label={t("canvas.references.connected", { count: connected.length })} data-canvas-connected-references>
            {connected.map((reference, index) => {
                const kindIndex = kindIndexes[reference.kind]++;
                const usedLimit = usedReferenceCounts?.[reference.kind];
                const isUsed = usedLimit === undefined || kindIndex < usedLimit;
                const canReorder = Boolean(onReorderReference || (onReorder && reference.connectionId));
                return (
                    <div
                    key={reference.id}
                    className={`td-canvas-reference-item group relative shrink-0 overflow-hidden rounded-xl border text-left outline-none transition-[border-color,transform,box-shadow,filter,opacity] duration-150 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-offset-1 ${fillHeight ? "h-full aspect-square" : "size-[60px]"} ${canReorder ? "cursor-grab active:cursor-grabbing" : ""} ${isUsed ? "" : "border-dashed grayscale"}`}
                    style={
                        {
                            background: theme.node.fill,
                            borderColor: dropTargetReferenceId === reference.id ? theme.node.activeStroke : theme.toolbar.border,
                            color: theme.node.muted,
                            opacity: draggingReferenceId === reference.id ? (isUsed ? 0.45 : 0.22) : isUsed ? 1 : 0.38,
                            filter: isUsed ? undefined : "grayscale(1) saturate(.2)",
                            boxShadow: dropTargetReferenceId === reference.id ? `0 0 0 2px ${theme.node.activeStroke}33` : undefined,
                            "--reference-active": theme.node.activeStroke,
                            "--tw-ring-color": theme.node.activeStroke,
                            "--tw-ring-offset-color": theme.toolbar.panel,
                            animationDelay: `${Math.min(index * 28, 140)}ms`,
                        } as CSSProperties
                    }
                    data-reference-node-id={reference.nodeId}
                    data-reference-kind={reference.kind}
                    data-reference-order={index + 1}
                    data-reference-used={isUsed ? "true" : "false"}
                    data-reference-source={reference.source}
                    data-reference-dragging={draggingReferenceId === reference.id ? "true" : undefined}
                    draggable={canReorder}
                    role="listitem"
                    onDragStart={(event) => startReferenceDrag(event, reference)}
                    onDragOver={(event) => {
                        if (!canReorder || !draggingReferenceId || draggingReferenceId === reference.id) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropTargetReferenceId(reference.id);
                    }}
                    onDragLeave={() => setDropTargetReferenceId((current) => (current === reference.id ? null : current))}
                    onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = draggingReferenceId || event.dataTransfer.getData("application/x-tdcanvas-reference");
                        const source = connected.find((item) => item.id === sourceId);
                        if (source && source.id !== reference.id) {
                            if (onReorderReference) onReorderReference(source, reference);
                            else if (source.connectionId && reference.connectionId) onReorder?.(source.connectionId, reference.connectionId);
                        }
                        setDraggingReferenceId(null);
                        setDropTargetReferenceId(null);
                    }}
                    onDragEnd={() => {
                        setDraggingReferenceId(null);
                        setDropTargetReferenceId(null);
                    }}
                >
                    <button
                        type="button"
                        className="absolute inset-0 size-full text-left"
                        title={isUsed ? t("canvas.references.focus", { title: reference.title }) : t("canvas.references.notUsedReason", { title: reference.title })}
                        aria-label={t("canvas.references.focus", { title: reference.title })}
                        onClick={() => onFocusNode?.(reference.nodeId)}
                    >
                        <ReferencePreview reference={reference} />
                        <span className="absolute inset-x-1 bottom-1 z-10 truncate rounded-md bg-black/65 px-1 py-0.5 text-center text-[9px] font-medium leading-3 text-white backdrop-blur-sm">{reference.label}</span>
                    </button>
                    {!isUsed ? (
                        <span className="pointer-events-none absolute inset-x-1 top-1/2 z-20 -translate-y-1/2 rounded-md bg-black/75 px-1 py-1 text-center text-[9px] font-semibold leading-3 text-white backdrop-blur-sm">
                            {t("canvas.references.notUsed")}
                        </span>
                    ) : null}
                    {onRemoveReference || (reference.connectionId && onDisconnect) ? (
                        <button
                            type="button"
                            className="absolute right-1 top-1 z-20 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
                            aria-label={t("canvas.references.disconnect", { title: reference.title })}
                            title={t("canvas.references.disconnect", { title: reference.title })}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (onRemoveReference) onRemoveReference(reference);
                                else if (reference.connectionId) onDisconnect?.(reference.connectionId);
                            }}
                        >
                            <X className="size-3" aria-hidden="true" />
                        </button>
                    ) : null}
                    {canReorder ? (
                        <span className="pointer-events-none absolute left-1 top-1 z-20 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-80" aria-hidden="true">
                            {reference.source === "object" ? <Boxes className="size-3" /> : <GripVertical className="size-3" />}
                        </span>
                    ) : null}
                    <span className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent transition-colors duration-150 group-hover:border-[var(--reference-active)]" />
                    </div>
                );
            })}
        </div>
    );

    function startReferenceDrag(event: DragEvent<HTMLDivElement>, reference: CanvasResourceReference) {
        if (!onReorderReference && (!reference.connectionId || !onReorder)) {
            event.preventDefault();
            return;
        }
        setDraggingReferenceId(reference.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-tdcanvas-reference", reference.id);
        event.dataTransfer.setData("text/plain", reference.id);
    }
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) {
        return <img src={reference.previewUrl} alt="" className="absolute inset-0 size-full object-cover" draggable={false} onError={(event) => (event.currentTarget.style.display = "none")} />;
    }

    if (reference.kind === "video" && reference.previewUrl) {
        return (
            <>
                <video src={reference.previewUrl} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" aria-hidden="true" onError={(event) => (event.currentTarget.style.display = "none")} />
                <span className="absolute inset-0 grid place-items-center bg-black/15 text-white">
                    <Play className="size-4 fill-current drop-shadow" aria-hidden="true" />
                </span>
            </>
        );
    }

    if (reference.kind === "text") {
        return (
            <span className="absolute inset-0 flex flex-col justify-between p-2">
                <FileText className="size-4 opacity-55" aria-hidden="true" />
                <span className="line-clamp-2 text-[9px] leading-3 opacity-70">{reference.text || reference.title}</span>
            </span>
        );
    }

    return (
        <span className="absolute inset-0 grid place-items-center">
            <ReferenceKindIcon kind={reference.kind} />
        </span>
    );
}

function ReferenceKindIcon({ kind }: { kind: CanvasResourceKind }) {
    if (kind === "video") return <Video className="size-5 opacity-55" aria-hidden="true" />;
    if (kind === "audio") return <Music2 className="size-5 opacity-55" aria-hidden="true" />;
    if (kind === "text") return <FileText className="size-5 opacity-55" aria-hidden="true" />;
    return <ImageIcon className="size-5 opacity-55" aria-hidden="true" />;
}
