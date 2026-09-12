import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Check, FileText, Image as ImageIcon, Music2, Search, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { resolveCanvasNodeResource, type CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasObjectReference } from "@/types/canvas";
import type { CanvasNodeResource } from "@/types/canvas-plugin";
import { CanvasNodeAnchoredPopup } from "./canvas-node-popup";

type CanvasObjectReferencePickerProps = {
    currentNodeId: string;
    nodes: CanvasNodeData[];
    references: CanvasObjectReference[];
    targetInputId?: string;
    allowedKinds?: CanvasResourceKind[];
    disabled?: boolean;
    square?: boolean;
    onAdd: (sourceNodeId: string) => void;
    onRemove: (referenceId: string) => void;
};

type ReferenceCandidate = {
    node: CanvasNodeData;
    resource: CanvasNodeResource;
};

export function CanvasObjectReferencePicker({ currentNodeId, nodes, references, targetInputId, allowedKinds, disabled = false, square = false, onAdd, onRemove }: CanvasObjectReferencePickerProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const anchorRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const candidates = useMemo(
        () =>
            nodes.flatMap((node): ReferenceCandidate[] => {
                if (node.id === currentNodeId || !node.metadata?.canvasSetEnabled) return [];
                const resource = resolveCanvasNodeResource(node);
                return resource && (!allowedKinds?.length || allowedKinds.includes(resource.kind)) ? [{ node, resource }] : [];
            }),
        [allowedKinds, currentNodeId, nodes],
    );
    const scopedReferences = useMemo(() => references.filter((reference) => (reference.targetInputId || "") === (targetInputId || "")), [references, targetInputId]);
    const selectedBySource = useMemo(() => new Map(scopedReferences.map((reference) => [`${reference.sourceNodeId}:${reference.outputPortId || ""}`, reference])), [scopedReferences]);
    const visibleCandidates = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return candidates;
        return candidates.filter(({ node, resource }) => `${node.title} ${kindLabel(resource.kind, t)}`.toLowerCase().includes(keyword));
    }, [candidates, query, t]);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target as Node;
            if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        window.addEventListener("pointerdown", close, true);
        return () => window.removeEventListener("pointerdown", close, true);
    }, [open]);

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                className={
                    square
                        ? "grid h-full aspect-square shrink-0 place-items-center rounded-xl border border-dashed transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5"
                        : "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5"
                }
                style={square ? { borderColor: theme.node.stroke, color: theme.node.muted } : { color: scopedReferences.length ? theme.node.activeStroke : theme.node.muted }}
                disabled={disabled}
                aria-label={t("canvas.objectReferences.add")}
                title={t("canvas.objectReferences.addHint")}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                <Boxes className="size-4" aria-hidden="true" />
                {!square ? <span>{t("canvas.objectReferences.add")}</span> : null}
                {!square && scopedReferences.length ? <span className="text-[10px] tabular-nums opacity-70">{scopedReferences.length}</span> : null}
            </button>

            <CanvasNodeAnchoredPopup open={open} anchorRef={anchorRef} panelRef={panelRef} placement="topLeft" width={380} maxHeight={500} flipVertical>
                <div className="overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
                    <div className="border-b px-3 pb-2.5 pt-3" style={{ borderColor: theme.toolbar.border }}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold">{t("canvas.objectReferences.title")}</div>
                                <div className="mt-0.5 text-[10px] leading-4" style={{ color: theme.node.faint }}>
                                    {t("canvas.objectReferences.description")}
                                </div>
                            </div>
                            <span className="text-[10px] tabular-nums" style={{ color: theme.node.faint }}>
                                {t("canvas.objectReferences.available", { count: candidates.length })}
                            </span>
                        </div>
                        <label className="mt-2.5 flex h-9 items-center gap-2 rounded-xl border px-2.5" style={{ borderColor: theme.toolbar.border, background: theme.node.fill }}>
                            <Search className="size-3.5 shrink-0" style={{ color: theme.node.faint }} aria-hidden="true" />
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                                style={{ color: theme.node.text }}
                                placeholder={t("canvas.objectReferences.search")}
                                autoFocus
                            />
                        </label>
                    </div>

                    <div className="thin-scrollbar max-h-[360px] overflow-y-auto p-2">
                        {visibleCandidates.length ? (
                            <div className="space-y-1">
                                {visibleCandidates.map(({ node, resource }) => {
                                    const selected = selectedBySource.get(`${node.id}:`);
                                    return (
                                        <button
                                            key={node.id}
                                            type="button"
                                            className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                                            aria-pressed={Boolean(selected)}
                                            onClick={() => (selected ? onRemove(selected.id) : onAdd(node.id))}
                                        >
                                            <ObjectPreview resource={resource} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-xs font-medium" title={node.title}>
                                                    {node.title}
                                                </span>
                                                <span className="mt-0.5 flex items-center gap-1.5 text-[10px]" style={{ color: theme.node.faint }}>
                                                    <span>{kindLabel(resource.kind, t)}</span>
                                                    <span>·</span>
                                                    <span>{node.metadata?.sourceOrigin === "upload" || node.metadata?.sourceOrigin === "asset" ? t("canvas.objectReferences.material") : t("canvas.objectReferences.result")}</span>
                                                </span>
                                            </span>
                                            <span
                                                className="grid size-6 shrink-0 place-items-center rounded-full border"
                                                style={{ borderColor: selected ? theme.node.activeStroke : theme.toolbar.border, color: selected ? theme.node.activeStroke : theme.node.faint }}
                                            >
                                                {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="px-4 py-10 text-center text-xs leading-5" style={{ color: theme.node.faint }}>
                                {candidates.length ? t("canvas.objectReferences.noMatch") : t("canvas.objectReferences.empty")}
                            </div>
                        )}
                    </div>
                </div>
            </CanvasNodeAnchoredPopup>
        </>
    );
}

function ObjectPreview({ resource }: { resource: CanvasNodeResource }) {
    if (resource.kind === "image" && resource.url) return <img src={resource.url} alt="" className="size-11 shrink-0 rounded-lg object-cover" draggable={false} />;
    return (
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-black/5 dark:bg-white/5">
            <KindIcon kind={resource.kind} />
        </span>
    );
}

function KindIcon({ kind }: { kind: CanvasResourceKind }) {
    if (kind === "video") return <Video className="size-4 opacity-60" aria-hidden="true" />;
    if (kind === "audio") return <Music2 className="size-4 opacity-60" aria-hidden="true" />;
    if (kind === "text") return <FileText className="size-4 opacity-60" aria-hidden="true" />;
    return <ImageIcon className="size-4 opacity-60" aria-hidden="true" />;
}

function kindLabel(kind: CanvasResourceKind, t: (key: string) => string) {
    return t(`canvas.objectReferences.kinds.${kind}`);
}
