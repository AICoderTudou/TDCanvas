import { Button, Input, InputNumber, Select, Switch } from "antd";
import { ArrowRight, CheckCircle2, Cpu, FileJson, Link2, LoaderCircle, Play, Search, SlidersHorizontal, Square, Workflow } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import type { ComfyExposedInput, ComfyWorkflowDefinition } from "./index";
import { isComfyWorkflowRunning, runComfyWorkflowNode, stopComfyWorkflowNode } from "./execution";
import { ensureComfyResultNodeOps, replaceComfyResultNodeOps } from "./result-nodes";
import { ComfyWorkflowExposureEditor } from "./workflow-import-wizard";
import { getComfyWorkflowDefinition, listComfyWorkflowDefinitions } from "./workflow-library";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { CanvasObjectReferencePicker } from "@/components/canvas/canvas-object-reference-picker";
import type { CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodePort, CanvasPortDataType, Position } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export const COMFY_WORKFLOW_NODE_TYPE = "comfyui-local:workflow";
const COMFY_PLUGIN_ID = "comfyui-local";

export type ComfyCanvasNodeSnapshot = {
    workflowId: string;
    environmentId: string;
    workflowHash: string;
    description?: string;
    runnable: boolean;
    inputs: ComfyWorkflowDefinition["inputs"];
    outputs: ComfyWorkflowDefinition["outputs"];
    values: Record<string, unknown>;
    inputEnabled?: Record<string, boolean>;
};

let registered = false;

export function registerComfyWorkflowCanvasNode() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(
        [
            {
                type: COMFY_WORKFLOW_NODE_TYPE,
                title: "ComfyUI 工作流",
                description: "本地 ComfyUI API 工作流",
                icon: <Cpu className="size-4" />,
                defaultSize: { width: 460, height: 280 },
                defaultMetadata: { status: "idle" },
                minimapColor: "#8b5cf6",
                showInCreateMenu: true,
                createMenuPlacement: "primary",
                autoOpenPanel: true,
                ports: (node) => comfyCanvasPorts(readComfySnapshot(node.metadata)),
                Content: ComfyWorkflowNodeContent,
                Panel: ComfyWorkflowNodePanel,
                toolbar: (ctx) => {
                    const running = isComfyWorkflowRunning(ctx.node);
                    return [
                        {
                            id: running ? "comfy-stop" : "comfy-run",
                            title: i18n.t(running ? "comfyuiLocal.canvasNode.stop" : "comfyuiLocal.canvasNode.run"),
                            label: i18n.t(running ? "comfyuiLocal.canvasNode.stop" : "comfyuiLocal.canvasNode.run"),
                            icon: running ? <Square className="size-3.5 fill-current" /> : <Play className="size-4 fill-current" />,
                            danger: running,
                            onClick: () => void (running ? stopComfyWorkflowNode(ctx) : runComfyWorkflowNode(ctx)),
                        },
                        { id: "comfy-parameters", title: i18n.t("comfyuiLocal.canvasNode.editParameters"), label: i18n.t("comfyuiLocal.canvasNode.parametersShort"), icon: <SlidersHorizontal className="size-4" />, onClick: ctx.openPanel },
                    ];
                },
            },
        ],
        COMFY_PLUGIN_ID,
    );
}

export function createComfyWorkflowCanvasNode(definition: ComfyWorkflowDefinition, position: Position): CanvasNodeData {
    return {
        ...createCanvasNode(COMFY_WORKFLOW_NODE_TYPE, position, {
            comfyuiLocal: createComfyCanvasNodeSnapshot(definition),
            status: definition.dependencySnapshot.runnable ? "idle" : "error",
            errorDetails: definition.dependencySnapshot.runnable ? undefined : "当前环境缺少工作流依赖",
        }),
        title: definition.name,
    };
}

export function createComfyCanvasNodeSnapshot(definition: ComfyWorkflowDefinition): ComfyCanvasNodeSnapshot {
    return {
        workflowId: definition.id,
        environmentId: definition.environmentId,
        workflowHash: definition.workflowHash,
        description: definition.description,
        runnable: definition.dependencySnapshot.runnable,
        inputs: definition.inputs,
        outputs: definition.outputs,
        values: Object.fromEntries(definition.inputs.map((input) => [input.id, input.defaultValue])),
    };
}

export function mergeComfyCanvasNodeSnapshot(definition: ComfyWorkflowDefinition, previous?: ComfyCanvasNodeSnapshot | null): ComfyCanvasNodeSnapshot {
    const next = createComfyCanvasNodeSnapshot(definition);
    if (!previous || previous.workflowId !== definition.id) return next;
    return {
        ...next,
        values: Object.fromEntries(definition.inputs.map((input) => [input.id, Object.hasOwn(previous.values, input.id) ? previous.values[input.id] : input.defaultValue])),
        inputEnabled: Object.fromEntries(definition.inputs.filter((input) => previous.inputEnabled?.[input.id] === false).map((input) => [input.id, false])),
    };
}

export function comfyCanvasPorts(snapshot: ComfyCanvasNodeSnapshot | null): CanvasNodePort[] {
    if (!snapshot) return [];
    return [
        ...snapshot.inputs.filter((input) => input.canvasPort).map((input) => ({ id: input.id, label: input.label, direction: "input" as const, dataType: inputPortType(input), required: input.required, multiple: false })),
        // Every selected workflow output owns a managed result node, so it must
        // remain addressable even when the user did not expose it for ad-hoc wiring.
        ...snapshot.outputs.map((output) => ({ id: output.id, label: output.label, direction: "output" as const, dataType: outputPortType(output.resourceType), multiple: true })),
    ];
}

function ComfyWorkflowNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const snapshot = readComfySnapshot(ctx.node.metadata);
    if (!snapshot)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center" style={{ color: ctx.theme.node.muted }}>
                <div className="grid size-16 place-items-center rounded-[20px] border" style={{ borderColor: ctx.theme.node.stroke, background: `${ctx.theme.toolbar.activeBg}88` }}>
                    <Workflow className="size-7 opacity-65" />
                </div>
                <div className="text-[14px] font-semibold" style={{ color: ctx.theme.node.text }}>
                    {t("comfyuiLocal.canvasNode.chooseWorkflow")}
                </div>
                <div className="max-w-72 text-[11px] leading-5 opacity-55">{t("comfyuiLocal.canvasNode.chooseWorkflowHint")}</div>
            </div>
        );
    const visibleInputs = snapshot.inputs.slice(0, 4);
    const outputTypes = [...new Set(snapshot.outputs.map((output) => output.resourceType))];
    const runPhase = readComfyRunPhase(ctx.node.metadata);
    const running = runPhase === "preparing" || runPhase === "queued" || runPhase === "running";
    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-4">
            <div className="flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: ctx.theme.toolbar.border }}>
                <div className="flex items-center gap-2.5 text-[12px] font-semibold" style={{ color: ctx.theme.node.text }}>
                    <span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-400">
                        <Cpu className="size-4" />
                    </span>
                    ComfyUI
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium" style={{ borderColor: ctx.theme.toolbar.border, color: ctx.theme.node.muted }}>
                    {running ? (
                        <LoaderCircle className="size-3 animate-spin text-violet-400" />
                    ) : (
                        <span className={runPhase === "failed" ? "size-1.5 rounded-full bg-red-400" : snapshot.runnable ? "size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]" : "size-1.5 rounded-full bg-amber-400"} />
                    )}
                    {t(runPhase ? `comfyuiLocal.canvasNode.phase.${runPhase}` : snapshot.runnable ? "comfyuiLocal.canvasNode.ready" : "comfyuiLocal.canvasNode.missingDependencies")}
                </span>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid content-start gap-2 overflow-hidden">
                    {visibleInputs.map((input) => (
                        <div key={input.id} className="flex min-w-0 items-center justify-between gap-4 text-[11px]">
                            <span className="truncate" style={{ color: ctx.theme.node.muted }}>
                                {input.label}
                            </span>
                            <span className="max-w-[58%] truncate font-mono text-[10px]" style={{ color: ctx.theme.node.text }}>
                                {displayValue(snapshot.values[input.id])}
                            </span>
                        </div>
                    ))}
                    {snapshot.inputs.length > visibleInputs.length ? (
                        <div className="pt-0.5 text-[10px] opacity-40">
                            +{snapshot.inputs.length - visibleInputs.length} {t("comfyuiLocal.canvasNode.moreParameters")}
                        </div>
                    ) : null}
                </div>
                <div className="flex items-start gap-1.5">
                    {outputTypes.map((type) => (
                        <span key={type} className="rounded-md border px-2 py-1 text-[9px] uppercase tracking-[0.08em]" style={{ borderColor: ctx.theme.toolbar.border, color: ctx.theme.node.muted }}>
                            {type}
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex items-center justify-between border-t pt-3 text-[10px]" style={{ borderColor: ctx.theme.toolbar.border, color: ctx.theme.node.muted }}>
                <span>{t("comfyuiLocal.canvasNode.clickToEdit")}</span>
                <span className="tabular-nums">
                    {snapshot.inputs.length} {t("comfyuiLocal.canvasNode.inputs")} · {snapshot.outputs.length} {t("comfyuiLocal.canvasNode.outputs")}
                </span>
            </div>
        </div>
    );
}

function ComfyWorkflowNodePanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { t } = useTranslation();
    const snapshot = readComfySnapshot(ctx.node.metadata);
    const [selectingWorkflow, setSelectingWorkflow] = useState(!snapshot);
    const [editingDefinition, setEditingDefinition] = useState<ComfyWorkflowDefinition | null>(null);
    useEffect(() => setSelectingWorkflow(!snapshot), [snapshot]);

    const useWorkflow = (definition: ComfyWorkflowDefinition, reconcilePorts = false) => {
        const next = mergeComfyCanvasNodeSnapshot(definition, snapshot);
        const nextPortIds = new Set([...next.inputs, ...next.outputs].map((item) => item.id));
        const staleConnectionIds = reconcilePorts
            ? ctx.getConnections().filter((connection) => (connection.fromNodeId === ctx.node.id && connection.fromPortId && !nextPortIds.has(connection.fromPortId)) || (connection.toNodeId === ctx.node.id && connection.toPortId && !nextPortIds.has(connection.toPortId))).map((connection) => connection.id)
            : [];
        const metadata: CanvasNodeMetadata = {
            comfyuiLocal: next,
            comfyuiRun: undefined,
            ...(reconcilePorts ? { objectReferences: (ctx.node.metadata?.objectReferences || []).filter((reference) => Boolean(reference.targetInputId && nextPortIds.has(reference.targetInputId))) } : {}),
            status: definition.dependencySnapshot.runnable ? "idle" : "error",
            errorDetails: definition.dependencySnapshot.runnable ? undefined : t("comfyuiLocal.canvasNode.dependencyError"),
        };
        const source = { ...ctx.node, title: definition.name, metadata: { ...ctx.node.metadata, ...metadata } };
        const nodes = ctx.getNodes().map((node) => (node.id === source.id ? source : node));
        const resultOps = reconcilePorts || (snapshot?.workflowId && snapshot.workflowId !== definition.id) ? replaceComfyResultNodeOps(source, definition, nodes, ctx.getConnections()) : ensureComfyResultNodeOps(source, definition, nodes, ctx.getConnections());
        ctx.applyOps([...(staleConnectionIds.length ? [{ type: "delete_connections" as const, ids: staleConnectionIds }] : []), { type: "update_node", id: source.id, patch: { title: definition.name }, metadata }, ...resultOps]);
        setSelectingWorkflow(false);
    };

    const editExposure = async () => {
        const definition = snapshot ? await getComfyWorkflowDefinition(snapshot.workflowId) : null;
        if (definition) setEditingDefinition(definition);
    };

    return (
        <div
            className="overflow-hidden rounded-[22px] border p-5 shadow-[0_22px_70px_rgba(0,0,0,.28)] backdrop-blur-2xl"
            style={{ background: ctx.theme.node.panel, borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text }}
            data-canvas-no-zoom
            onPointerDown={(event) => event.stopPropagation()}
        >
            {selectingWorkflow || !snapshot ? (
                <ComfyWorkflowPicker currentWorkflowId={snapshot?.workflowId} onSelect={useWorkflow} onClose={snapshot ? () => setSelectingWorkflow(false) : onClose} />
            ) : (
                <ComfyWorkflowParameters ctx={ctx} snapshot={snapshot} onEditExposure={() => void editExposure()} onChangeWorkflow={() => setSelectingWorkflow(true)} onClose={onClose} />
            )}
            {editingDefinition ? <ComfyWorkflowExposureEditor open definition={editingDefinition} onClose={() => setEditingDefinition(null)} onSaved={(definition) => { useWorkflow(definition, true); setEditingDefinition(null); }} /> : null}
        </div>
    );
}

function ComfyWorkflowPicker({ currentWorkflowId, onSelect, onClose }: { currentWorkflowId?: string; onSelect: (definition: ComfyWorkflowDefinition) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [workflows, setWorkflows] = useState<ComfyWorkflowDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [keyword, setKeyword] = useState("");

    useEffect(() => {
        let disposed = false;
        setLoading(true);
        listComfyWorkflowDefinitions()
            .then((items) => {
                if (!disposed) setWorkflows(items);
            })
            .catch((reason) => {
                if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });
        return () => {
            disposed = true;
        };
    }, []);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        if (!query) return workflows;
        return workflows.filter((workflow) => [workflow.name, workflow.description || "", workflow.workflowHash].join(" ").toLowerCase().includes(query));
    }, [keyword, workflows]);

    return (
        <div>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-[17px] font-semibold">{t(currentWorkflowId ? "comfyuiLocal.canvasNode.changeWorkflow" : "comfyuiLocal.canvasNode.chooseWorkflow")}</h3>
                    <p className="mt-1 text-[11px] opacity-50">{t("comfyuiLocal.canvasNode.workflowLibraryHint")}</p>
                </div>
                <Button size="small" onClick={onClose}>
                    {t("common.cancel")}
                </Button>
            </div>
            <Input className="mt-4" allowClear prefix={<Search className="size-4 opacity-45" />} placeholder={t("comfyuiLocal.canvasNode.searchWorkflow")} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <div className="thin-scrollbar mt-4 max-h-[310px] space-y-2 overflow-y-auto pr-1">
                {loading ? <div className="grid min-h-32 place-items-center text-[12px] opacity-45">{t("comfyuiLocal.canvasNode.loadingWorkflows")}</div> : null}
                {!loading && error ? <div className="grid min-h-32 place-items-center px-5 text-center text-[12px] text-red-400">{error}</div> : null}
                {!loading && !error
                    ? filtered.map((workflow) => {
                          const current = workflow.id === currentWorkflowId;
                          return (
                              <button
                                  key={workflow.id}
                                  type="button"
                                  className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition hover:border-violet-500/45 hover:bg-violet-500/[0.045] ${current ? "border-violet-500/45 bg-violet-500/[0.035]" : "border-black/[0.09] dark:border-white/[0.09]"}`}
                                  onClick={() => onSelect(workflow)}
                              >
                                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-400">
                                      <FileJson className="size-[18px]" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                      <span className="flex items-center gap-2">
                                          <span className="truncate text-[13px] font-semibold">{workflow.name}</span>
                                          {current ? <CheckCircle2 className="size-3.5 shrink-0 text-violet-400" /> : null}
                                      </span>
                                      <span className="mt-1 block truncate text-[10px] opacity-45">
                                          {workflow.inputs.length} {t("comfyuiLocal.canvasNode.inputs")} · {workflow.outputs.length} {t("comfyuiLocal.canvasNode.outputs")}
                                      </span>
                                  </span>
                                  <ArrowRight className="size-4 shrink-0 opacity-30 transition group-hover:translate-x-0.5 group-hover:opacity-80" />
                              </button>
                          );
                      })
                    : null}
                {!loading && !error && !filtered.length ? (
                    <div className="grid min-h-32 place-items-center px-5 text-center text-[12px] opacity-45">{workflows.length ? t("comfyuiLocal.canvasNode.noMatchingWorkflow") : t("comfyuiLocal.canvasNode.noWorkflows")}</div>
                ) : null}
            </div>
        </div>
    );
}

function ComfyWorkflowParameters({ ctx, snapshot, onEditExposure, onChangeWorkflow, onClose }: { ctx: CanvasNodeContext; snapshot: ComfyCanvasNodeSnapshot; onEditExposure: () => void; onChangeWorkflow: () => void; onClose: () => void }) {
    const { t } = useTranslation();
    const updateValue = (id: string, value: unknown) => ctx.updateMetadata({ comfyuiLocal: { ...snapshot, values: { ...snapshot.values, [id]: value } } });
    const updateInputEnabled = (input: ComfyExposedInput, enabled: boolean) => {
        const sameNodeInputs = snapshot.inputs.filter((candidate) => candidate.nodeId === input.nodeId && candidate.control === "media");
        const inputEnabled = { ...snapshot.inputEnabled };
        for (const candidate of sameNodeInputs) inputEnabled[candidate.id] = enabled;
        ctx.updateMetadata({ comfyuiLocal: { ...snapshot, inputEnabled } });
    };
    const updateObjectReference = (inputId: string, sourceNodeId: string) => {
        const connectedIds = ctx.getInputConnections(inputId).map((connection) => connection.id);
        if (connectedIds.length) ctx.applyOps([{ type: "delete_connections", ids: connectedIds }]);
        const references = (ctx.node.metadata?.objectReferences || []).filter((reference) => reference.targetInputId !== inputId);
        ctx.updateMetadata({ objectReferences: [...references, { id: nanoid(), sourceNodeId, targetInputId: inputId, versionMode: "latest", createdAt: new Date().toISOString() }] });
    };
    const removeObjectReference = (referenceId: string) => {
        ctx.updateMetadata({ objectReferences: (ctx.node.metadata?.objectReferences || []).filter((reference) => reference.id !== referenceId) });
    };
    return (
        <div>
            <div className="flex items-start justify-between gap-4 border-b pb-4" style={{ borderColor: ctx.theme.toolbar.border }}>
                <div>
                    <div className="text-[17px] font-semibold">{t("comfyuiLocal.canvasNode.parameters")}</div>
                    <div className="mt-1 text-[11px] opacity-50">{t("comfyuiLocal.canvasNode.connectedOverride")}</div>
                </div>
                <div className="flex gap-2">
                    <Button size="small" onClick={onEditExposure}>
                        {t("comfyuiLocal.canvasNode.editExposure")}
                    </Button>
                    <Button size="small" onClick={onChangeWorkflow}>
                        {t("comfyuiLocal.canvasNode.changeWorkflow")}
                    </Button>
                    <Button type="primary" size="small" onClick={onClose}>
                        {t("common.done")}
                    </Button>
                </div>
            </div>
            <div className="thin-scrollbar grid max-h-[430px] gap-4 overflow-y-auto py-5 pr-1 sm:grid-cols-2">
                {snapshot.inputs.map((input) => {
                    const allowedKinds = comfyInputObjectKinds(input);
                    return (
                        <ParameterControl
                            key={input.id}
                            input={input}
                            value={snapshot.values[input.id]}
                            onChange={(value) => updateValue(input.id, value)}
                            enabled={snapshot.inputEnabled?.[input.id] !== false}
                            onEnabledChange={(enabled) => updateInputEnabled(input, enabled)}
                            referencePicker={
                                input.canvasPort && allowedKinds.length ? (
                                    <CanvasObjectReferencePicker
                                        currentNodeId={ctx.node.id}
                                        nodes={ctx.getNodes()}
                                        references={ctx.node.metadata?.objectReferences || []}
                                        targetInputId={input.id}
                                        allowedKinds={allowedKinds}
                                        onAdd={(sourceNodeId) => updateObjectReference(input.id, sourceNodeId)}
                                        onRemove={removeObjectReference}
                                    />
                                ) : undefined
                            }
                        />
                    );
                })}
            </div>
            {!snapshot.inputs.length ? <div className="py-12 text-center text-[12px] opacity-45">{t("comfyuiLocal.canvasNode.noParameters")}</div> : null}
        </div>
    );
}

function ParameterControl({ input, value, onChange, enabled = true, onEnabledChange, referencePicker }: { input: ComfyExposedInput; value: unknown; onChange: (value: unknown) => void; enabled?: boolean; onEnabledChange?: (enabled: boolean) => void; referencePicker?: ReactNode }) {
    const { t } = useTranslation();
    const label = (
        <div className="mb-2 flex min-w-0 items-center gap-2 text-[11px] font-medium opacity-65" title={input.label}>
            <span className="truncate">{input.label}</span>
            {input.canvasPort ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-400">
                    <Link2 className="size-2.5" />
                    {t("comfyuiLocal.canvasNode.port")}
                </span>
            ) : null}
            <span className="ml-auto flex items-center gap-2">
                {input.control === "media" && onEnabledChange ? (
                    <label className="inline-flex items-center gap-1.5 text-[10px] opacity-80">
                        <span>{t(enabled ? "comfyuiLocal.canvasNode.inputUse" : "comfyuiLocal.canvasNode.inputBypass")}</span>
                        <Switch size="small" checked={enabled} onChange={onEnabledChange} />
                    </label>
                ) : null}
                {referencePicker}
            </span>
        </div>
    );
    if (input.control === "media")
        return (
            <div className="block">
                {label}
                <div className={`flex h-10 items-center rounded-lg border border-dashed border-white/[0.12] px-3 text-[11px] ${enabled ? "opacity-50" : "opacity-30"}`}>
                    {t(enabled ? "comfyuiLocal.canvasNode.connectMedia" : "comfyuiLocal.canvasNode.inputBypassHint", { type: input.valueType })}
                </div>
            </div>
        );
    if (input.control === "switch")
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] px-3 py-2.5">
                {label}
                <Switch size="small" checked={Boolean(value)} onChange={onChange} />
            </div>
        );
    if (input.control === "select")
        return (
            <div className="block">
                {label}
                <Select className="w-full" size="small" value={typeof value === "string" ? value : undefined} options={(input.enumValues || []).map((item) => ({ value: item, label: item }))} onChange={onChange} />
            </div>
        );
    if (input.control === "number")
        return (
            <div className="block">
                {label}
                <InputNumber className="w-full" size="small" value={typeof value === "number" ? value : undefined} min={numberConstraint(input, "min")} max={numberConstraint(input, "max")} step={numberConstraint(input, "step")} onChange={onChange} />
            </div>
        );
    if (input.control === "textarea" || input.control === "json")
        return (
            <div className="block sm:col-span-2">
                {label}
                <Input.TextArea
                    rows={4}
                    className="!resize-y"
                    value={input.control === "json" ? JSON.stringify(value, null, 2) : String(value ?? "")}
                    onChange={(event) => onChange(input.control === "json" ? parseJsonOrText(event.target.value) : event.target.value)}
                />
            </div>
        );
    return (
        <div className="block">
            {label}
            <Input size="small" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
        </div>
    );
}

function comfyInputObjectKinds(input: ComfyExposedInput): CanvasResourceKind[] {
    if (input.valueType === "image") return ["image"];
    if (input.valueType === "video") return ["video"];
    if (input.valueType === "audio") return ["audio"];
    if (input.valueType === "string" || input.valueType === "enum" || input.valueType === "json" || input.valueType === "integer" || input.valueType === "number" || input.valueType === "boolean") return ["text"];
    return [];
}

function readComfySnapshot(metadata?: CanvasNodeMetadata): ComfyCanvasNodeSnapshot | null {
    const value = metadata?.comfyuiLocal;
    if (!value || typeof value !== "object") return null;
    const snapshot = value as Partial<ComfyCanvasNodeSnapshot>;
    return snapshot.workflowId && snapshot.environmentId && Array.isArray(snapshot.inputs) && Array.isArray(snapshot.outputs) && snapshot.values ? (snapshot as ComfyCanvasNodeSnapshot) : null;
}

function readComfyRunPhase(metadata?: CanvasNodeMetadata) {
    const value = metadata?.comfyuiRun;
    if (!value || typeof value !== "object") return "";
    const phase = (value as { phase?: unknown }).phase;
    return typeof phase === "string" ? phase : "";
}

function inputPortType(input: ComfyExposedInput): CanvasPortDataType {
    if (input.valueType === "integer" || input.valueType === "number") return "number";
    if (input.valueType === "boolean") return "boolean";
    if (input.valueType === "json") return "json";
    if (input.valueType === "enum" || input.valueType === "string") return "text";
    return input.valueType;
}

function outputPortType(resourceType: ComfyWorkflowDefinition["outputs"][number]["resourceType"]): CanvasPortDataType {
    return resourceType === "file" ? "any" : resourceType;
}

function displayValue(value: unknown) {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function numberConstraint(input: ComfyExposedInput, key: "min" | "max" | "step") {
    const value = input.constraints?.[key];
    return typeof value === "number" ? value : undefined;
}

function parseJsonOrText(value: string) {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
}
