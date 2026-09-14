import { App, Button, Input, Modal, Switch, Tooltip } from "antd";
import { AlertTriangle, Check, CircleHelp, FileJson, LoaderCircle, Search, Sparkles, UploadCloud } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";

import {
    buildComfyWorkflowDefinition,
    comfyNativeClient,
    comfyOutputLabel,
    inspectComfyWorkflow,
    parseComfyApiWorkflow,
    type ComfyEnvironmentProfile,
    type ComfyInspectedInput,
    type ComfyInspectedOutput,
    type ComfyWorkflowDefinition,
    type ComfyWorkflowInspection,
} from "./index";
import { saveComfyWorkflowDefinition } from "./workflow-library";
import { defaultComfyPortIds, filterComfySelectionItemsByNodeId, groupComfySelectionItems, smartDefaultComfyInputIds, type ComfySelectableItem } from "./workflow-selection";
import { cn } from "@/lib/utils";

type Props = {
    open: boolean;
    environment: ComfyEnvironmentProfile;
    onClose: () => void;
    onSaved: (definition: ComfyWorkflowDefinition) => void;
};

type ExposureEditorProps = {
    open: boolean;
    definition: ComfyWorkflowDefinition;
    onClose: () => void;
    onSaved: (definition: ComfyWorkflowDefinition) => void;
};

export function ComfyWorkflowExposureEditor({ open, definition, onClose, onSaved }: ExposureEditorProps) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [step, setStep] = useState<"input" | "output">("input");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [inspection, setInspection] = useState<ComfyWorkflowInspection | null>(null);
    const [inputIds, setInputIds] = useState<Set<string>>(new Set());
    const [outputIds, setOutputIds] = useState<Set<string>>(new Set());
    const [portIds, setPortIds] = useState<Set<string>>(new Set());
    const [labels, setLabels] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!open) return;
        let disposed = false;
        setStep("input");
        setLoading(true);
        comfyNativeClient
            .objectInfo()
            .then((objectInfo) => {
                if (disposed) return;
                const next = inspectComfyWorkflow(definition.apiWorkflow, objectInfo);
                setInspection(next);
                setInputIds(new Set(definition.inputs.map((input) => input.id)));
                setOutputIds(new Set(definition.outputs.map((output) => output.id)));
                setPortIds(new Set([...definition.inputs, ...definition.outputs].filter((item) => item.canvasPort).map((item) => item.id)));
                setLabels(Object.fromEntries([...next.inputs, ...next.outputs].map((item) => {
                    const savedLabel = definition.inputs.find((input) => input.id === item.id)?.label || definition.outputs.find((output) => output.id === item.id)?.label;
                    const label = "outputName" in item ? comfyOutputLabel(item) : item.label;
                    return [item.id, savedLabel?.toLowerCase() === "filenames" && "outputName" in item && item.resourceType === "video" ? label : savedLabel || label];
                })));
            })
            .catch((error) => message.error(errorMessage(error)))
            .finally(() => {
                if (!disposed) setLoading(false);
            });
        return () => {
            disposed = true;
        };
    }, [definition, message, open]);

    const save = async () => {
        if (!inspection) return;
        const selectedInputs = inspection.inputs.filter((input) => inputIds.has(input.id));
        const selectedOutputs = inspection.outputs.filter((output) => outputIds.has(output.id));
        if (!selectedOutputs.length) return message.error(t("comfyuiLocal.editExposure.outputRequired"));
        setSaving(true);
        try {
            const next = buildComfyWorkflowDefinition({
                id: definition.id,
                name: definition.name,
                description: definition.description,
                environmentId: definition.environmentId,
                inspection,
                inputs: selectedInputs.map((source) => ({ source, label: labels[source.id], canvasPort: portIds.has(source.id) })),
                outputs: selectedOutputs.map((source) => ({ source, label: labels[source.id], canvasPort: portIds.has(source.id), preview: definition.outputs.find((output) => output.id === source.id)?.preview ?? true })),
            });
            await saveComfyWorkflowDefinition(next);
            onSaved(next);
            message.success(t("comfyuiLocal.editExposure.saved"));
        } catch (error) {
            message.error(errorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} onCancel={onClose} width={920} centered destroyOnHidden title={t("comfyuiLocal.editExposure.title")} footer={[
            <Button key="cancel" onClick={onClose}>{t("common.cancel")}</Button>,
            step === "output" ? <Button key="back" onClick={() => setStep("input")}>{t("comfyuiLocal.import.back")}</Button> : null,
            step === "input" ? <Button key="next" type="primary" disabled={loading || !inspection} onClick={() => setStep("output")}>{t("comfyuiLocal.import.next")}</Button> : <Button key="save" type="primary" loading={saving} disabled={!outputIds.size} onClick={() => void save()}>{t("comfyuiLocal.import.save")}</Button>,
        ]}>
            <p className="mb-5 text-[11px] text-stone-500 dark:text-zinc-500">{t("comfyuiLocal.editExposure.description")}</p>
            {loading ? <div className="grid min-h-[420px] place-items-center"><LoaderCircle className="size-7 animate-spin text-violet-500" /></div> : null}
            {!loading && inspection ? <SelectionStep kind={step} items={(step === "input" ? inspection.inputs : inspection.outputs).filter((item) => item.exposable)} selected={step === "input" ? inputIds : outputIds} ports={portIds} labels={labels} onSelected={step === "input" ? setInputIds : setOutputIds} onPorts={setPortIds} onLabels={setLabels} /> : null}
        </Modal>
    );
}

export function ComfyWorkflowImportWizard({ open, environment, onClose, onSaved }: Props) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [step, setStep] = useState(0);
    const [reading, setReading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [fileName, setFileName] = useState("");
    const [inspection, setInspection] = useState<ComfyWorkflowInspection | null>(null);
    const [inputIds, setInputIds] = useState<Set<string>>(new Set());
    const [outputIds, setOutputIds] = useState<Set<string>>(new Set());
    const [portIds, setPortIds] = useState<Set<string>>(new Set());
    const [labels, setLabels] = useState<Record<string, string>>({});
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");

    useEffect(() => {
        if (!open) return;
        setStep(0);
        setReading(false);
        setSaving(false);
        setFileName("");
        setInspection(null);
        setInputIds(new Set());
        setOutputIds(new Set());
        setPortIds(new Set());
        setLabels({});
        setName("");
        setDescription("");
    }, [open]);

    const selectedInputs = useMemo(() => inspection?.inputs.filter((input) => inputIds.has(input.id)) || [], [inputIds, inspection]);
    const selectedOutputs = useMemo(() => inspection?.outputs.filter((output) => outputIds.has(output.id)) || [], [inspection, outputIds]);
    const canContinue = step === 0 ? Boolean(inspection) : step === 3 ? selectedOutputs.length > 0 : step === 4 ? Boolean(name.trim() && selectedOutputs.length) : true;

    const inspectFile = async (file?: File) => {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".json")) {
            message.error(t("comfyuiLocal.import.jsonOnly"));
            return;
        }
        setReading(true);
        try {
            const parsed = JSON.parse(await file.text()) as unknown;
            const workflow = parseComfyApiWorkflow(parsed);
            const objectInfo = await comfyNativeClient.objectInfo();
            const next = inspectComfyWorkflow(workflow, objectInfo);
            setFileName(file.name);
            setName(file.name.replace(/\.json$/i, ""));
            setInspection(next);
            const defaultInputs = smartDefaultComfyInputIds(next.inputs);
            const defaultOutputs = next.outputs.filter((output) => output.exposable && output.outputNode).map((output) => output.id);
            const fallbackOutputs = next.outputs.filter((output) => output.exposable).map((output) => output.id);
            const selectedOutputIds = defaultOutputs.length ? defaultOutputs : fallbackOutputs.slice(0, 1);
            setInputIds(new Set(defaultInputs));
            setOutputIds(new Set(selectedOutputIds));
            setPortIds(new Set(defaultComfyPortIds(next.inputs, selectedOutputIds)));
            setLabels(Object.fromEntries([...next.inputs, ...next.outputs].map((item) => [item.id, "label" in item ? item.label : item.outputName])));
            setStep(1);
        } catch (error) {
            message.error(errorMessage(error));
        } finally {
            setReading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault();
        void inspectFile(event.dataTransfer.files[0]);
    };

    const save = async () => {
        if (!inspection) return;
        setSaving(true);
        try {
            const definition = buildComfyWorkflowDefinition({
                id: nanoid(),
                name,
                description,
                environmentId: environment.id,
                inspection,
                inputs: selectedInputs.map((source) => ({ source, label: labels[source.id], canvasPort: portIds.has(source.id) })),
                outputs: selectedOutputs.map((source) => ({ source, label: labels[source.id], canvasPort: portIds.has(source.id), preview: true })),
            });
            await saveComfyWorkflowDefinition(definition);
            onSaved(definition);
            message.success(t("comfyuiLocal.import.saved"));
        } catch (error) {
            message.error(errorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const footer = (
        <div className="flex w-full items-center justify-between">
            <span className="text-[10px] text-stone-400 dark:text-zinc-600">{fileName || t("comfyuiLocal.import.noFile")}</span>
            <div className="flex gap-2">
                <Button onClick={step === 0 ? onClose : () => setStep((value) => Math.max(0, value - 1))}>{step === 0 ? t("common.cancel") : t("comfyuiLocal.import.back")}</Button>
                {step < 4 ? (
                    <Button type="primary" disabled={!canContinue || reading} onClick={() => setStep((value) => Math.min(4, value + 1))}>
                        {t("comfyuiLocal.import.next")}
                    </Button>
                ) : (
                    <Button type="primary" loading={saving} disabled={!canContinue} onClick={() => void save()}>
                        {t("comfyuiLocal.import.save")}
                    </Button>
                )}
            </div>
        </div>
    );

    return (
        <Modal open={open} onCancel={onClose} footer={footer} width={920} centered destroyOnHidden title={null} className="td-comfy-import-modal">
            <div className="min-h-[590px] pt-1">
                <div className="border-b border-black/[0.08] pb-5 dark:border-white/[0.08]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500">COMFYUI / API WORKFLOW</div>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">{t("comfyuiLocal.import.title")}</h2>
                    <p className="mt-1 text-[11px] text-stone-500 dark:text-zinc-500">{t("comfyuiLocal.import.description")}</p>
                </div>
                <WizardSteps active={step} />
                <div className="pt-6">
                    {step === 0 ? (
                        <button
                            type="button"
                            className="grid min-h-[360px] w-full cursor-pointer place-items-center border border-dashed border-black/[0.15] transition hover:border-violet-500/50 hover:bg-violet-500/[0.025] dark:border-white/[0.14]"
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={handleDrop}
                        >
                            <span className="flex flex-col items-center px-6 text-center">
                                {reading ? <LoaderCircle className="size-8 animate-spin text-violet-500" /> : <UploadCloud className="size-8 text-stone-400 dark:text-zinc-600" />}
                                <span className="mt-5 text-[14px] font-medium">{reading ? t("comfyuiLocal.import.reading") : t("comfyuiLocal.import.selectFile")}</span>
                                <span className="mt-2 max-w-lg text-[10px] leading-5 text-stone-400 dark:text-zinc-600">{t("comfyuiLocal.import.apiFormatHint")}</span>
                            </span>
                        </button>
                    ) : null}
                    {step === 1 && inspection ? <DependencyStep inspection={inspection} /> : null}
                    {step === 2 && inspection ? (
                        <SelectionStep kind="input" items={inspection.inputs.filter((item) => item.exposable)} selected={inputIds} ports={portIds} labels={labels} onSelected={setInputIds} onPorts={setPortIds} onLabels={setLabels} />
                    ) : null}
                    {step === 3 && inspection ? (
                        <SelectionStep kind="output" items={inspection.outputs.filter((item) => item.exposable)} selected={outputIds} ports={portIds} labels={labels} onSelected={setOutputIds} onPorts={setPortIds} onLabels={setLabels} />
                    ) : null}
                    {step === 4 && inspection ? <PreviewStep name={name} description={description} onName={setName} onDescription={setDescription} inputs={selectedInputs} outputs={selectedOutputs} ports={portIds} runnable={inspection.runnable} /> : null}
                </div>
                <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void inspectFile(event.target.files?.[0])} />
            </div>
        </Modal>
    );
}

function WizardSteps({ active }: { active: number }) {
    const { t } = useTranslation();
    const steps = ["file", "dependencies", "inputs", "outputs", "preview"] as const;
    return (
        <ol className="grid grid-cols-5 border-b border-black/[0.08] dark:border-white/[0.08]">
            {steps.map((key, index) => (
                <li key={key} className={cn("flex h-14 min-w-0 items-center gap-2 px-2 text-[10px]", index === active ? "text-stone-900 dark:text-zinc-100" : "text-stone-400 dark:text-zinc-600")}>
                    <span
                        className={cn(
                            "grid size-5 shrink-0 place-items-center rounded-full border text-[9px]",
                            index < active ? "border-emerald-500/40 text-emerald-500" : index === active ? "border-violet-500/50 bg-violet-500/10 text-violet-500" : "border-black/[0.1] dark:border-white/[0.1]",
                        )}
                    >
                        {index < active ? <Check className="size-3" /> : index + 1}
                    </span>
                    <span className="truncate">{t(`comfyuiLocal.import.steps.${key}`)}</span>
                </li>
            ))}
        </ol>
    );
}

function DependencyStep({ inspection }: { inspection: ComfyWorkflowInspection }) {
    const { t } = useTranslation();
    const customNodes = inspection.nodes.filter((node) => Boolean(node.pythonModule && !node.pythonModule.startsWith("nodes"))).length;
    return (
        <div>
            <div className={cn("flex items-start gap-4 border-l-2 px-4 py-3", inspection.runnable ? "border-emerald-500 bg-emerald-500/[0.035]" : "border-amber-500 bg-amber-500/[0.04]")}>
                {inspection.runnable ? <Check className="mt-0.5 size-4 text-emerald-500" /> : <AlertTriangle className="mt-0.5 size-4 text-amber-500" />}
                <div>
                    <div className="text-[12px] font-medium">{t(inspection.runnable ? "comfyuiLocal.import.dependenciesReady" : "comfyuiLocal.import.dependenciesMissing")}</div>
                    <p className="mt-1 text-[10px] leading-5 text-stone-500 dark:text-zinc-500">{t(inspection.runnable ? "comfyuiLocal.import.dependenciesReadyHint" : "comfyuiLocal.import.dependenciesMissingHint")}</p>
                </div>
            </div>
            <dl className="mt-6 grid border-y border-black/[0.08] dark:border-white/[0.08] sm:grid-cols-4">
                <Metric label={t("comfyuiLocal.import.nodeCount")} value={inspection.nodes.length} />
                <Metric label={t("comfyuiLocal.import.classCount")} value={new Set(inspection.nodes.map((node) => node.classType)).size} />
                <Metric label={t("comfyuiLocal.import.customCount")} value={customNodes} />
                <Metric label={t("comfyuiLocal.import.missingCount")} value={inspection.missingClassTypes.length} />
            </dl>
            {inspection.missingClassTypes.length ? (
                <div className="mt-6">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">{t("comfyuiLocal.import.missingClasses")}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {inspection.missingClassTypes.map((name) => (
                            <span key={name} className="border border-amber-500/20 bg-amber-500/[0.05] px-2 py-1 text-[10px] text-amber-600 dark:text-amber-300">
                                {name}
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

type SelectionProps = {
    kind: "input" | "output";
    items: ComfySelectableItem[];
    selected: Set<string>;
    ports: Set<string>;
    labels: Record<string, string>;
    onSelected: (value: Set<string>) => void;
    onPorts: (value: Set<string>) => void;
    onLabels: (value: Record<string, string>) => void;
};

export function SelectionStep({ kind, items, selected, ports, labels, onSelected, onPorts, onLabels }: SelectionProps) {
    const { t } = useTranslation();
    const [nodeIdQuery, setNodeIdQuery] = useState("");
    const toggle = (set: Set<string>, id: string, checked: boolean) => new Set(checked ? [...set, id] : [...set].filter((value) => value !== id));
    const filteredItems = useMemo(() => (kind === "input" ? filterComfySelectionItemsByNodeId(items, nodeIdQuery) : items), [items, kind, nodeIdQuery]);
    const groups = useMemo(() => groupComfySelectionItems(filteredItems), [filteredItems]);
    const smartIds = useMemo(() => (kind === "input" ? new Set(smartDefaultComfyInputIds(items as ComfyInspectedInput[])) : new Set<string>()), [items, kind]);

    useEffect(() => setNodeIdQuery(""), [kind]);

    const setItemSelected = (item: ComfySelectableItem, checked: boolean) => {
        onSelected(toggle(selected, item.id, checked));
        if (!checked) onPorts(toggle(ports, item.id, false));
        else if (kind === "output" || smartIds.has(item.id)) onPorts(toggle(ports, item.id, true));
    };

    const restoreSmartSelection = () => {
        if (kind !== "input") return;
        onSelected(new Set(smartIds));
        const itemIds = new Set(items.map((item) => item.id));
        const retainedPorts = [...ports].filter((id) => !itemIds.has(id));
        onPorts(new Set([...retainedPorts, ...defaultComfyPortIds(items as ComfyInspectedInput[], [])]));
    };

    const clearSelection = () => {
        const itemIds = new Set(items.map((item) => item.id));
        onSelected(new Set());
        onPorts(new Set([...ports].filter((id) => !itemIds.has(id))));
    };

    return (
        <div>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h3 className="text-[17px] font-semibold">{t(`comfyuiLocal.import.${kind}Title`)}</h3>
                    <p className="mt-1.5 text-[12px] text-stone-400 dark:text-zinc-500">{t(`comfyuiLocal.import.${kind}Hint`)}</p>
                </div>
                <div className="flex items-center gap-3">
                    {kind === "input" ? (
                        <button type="button" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-500 transition hover:text-violet-400" onClick={restoreSmartSelection}>
                            <Sparkles className="size-3.5" />
                            {t("comfyuiLocal.import.smartSelect")}
                        </button>
                    ) : null}
                    <button type="button" className="text-[11px] text-stone-400 transition hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-200" onClick={clearSelection}>
                        {t("comfyuiLocal.import.clearSelection")}
                    </button>
                    <span className="min-w-14 text-right text-[12px] font-medium tabular-nums text-violet-500">
                        {selected.size} / {items.length}
                    </span>
                </div>
            </div>
            {kind === "input" ? (
                <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <Input allowClear size="large" prefix={<Search className="size-4 text-stone-400" />} placeholder={t("comfyuiLocal.import.searchNodeId")} value={nodeIdQuery} onChange={(event) => setNodeIdQuery(event.target.value)} />
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-stone-400 dark:text-zinc-500">
                        <CircleHelp className="size-3.5" />
                        {t("comfyuiLocal.import.smartSelectionHint")}
                    </span>
                </div>
            ) : null}
            <div className="thin-scrollbar max-h-[390px] space-y-3 overflow-y-auto pr-1">
                {groups.map((group) => (
                    <section key={group.nodeId} className="overflow-hidden rounded-xl border border-black/[0.09] bg-black/[0.012] dark:border-white/[0.09] dark:bg-white/[0.018]">
                        <header className="flex min-w-0 items-center justify-between gap-4 border-b border-black/[0.07] px-4 py-3 dark:border-white/[0.07]">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="rounded-md bg-violet-500/10 px-2 py-1 font-mono text-[11px] font-semibold text-violet-500">#{group.nodeId}</span>
                                    <span className="truncate text-[13px] font-semibold">{group.nodeTitle}</span>
                                </div>
                                {group.classType !== group.nodeTitle ? <div className="mt-1 truncate pl-0.5 font-mono text-[10px] text-stone-400 dark:text-zinc-600">{group.classType}</div> : null}
                            </div>
                            <span className="shrink-0 text-[10px] tabular-nums text-stone-400 dark:text-zinc-600">{t("comfyuiLocal.import.parameterCount", { count: group.items.length })}</span>
                        </header>
                        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                            {group.items.map((item) => {
                                const checked = selected.has(item.id);
                                const type = "valueType" in item ? item.valueType : item.resourceType;
                                const field = "field" in item ? item.field : item.outputName;
                                const recommended = kind === "input" && smartIds.has(item.id);
                                return (
                                    <div
                                        key={item.id}
                                        className={cn(
                                            "grid gap-3 border-l-2 px-3 py-3.5 transition sm:grid-cols-[36px_minmax(0,1fr)_200px_112px] sm:items-center",
                                            checked ? "border-l-violet-500 bg-violet-500/[0.055]" : "border-l-transparent bg-transparent hover:bg-black/[0.025] dark:hover:bg-white/[0.025]",
                                        )}
                                    >
                                        <button
                                            type="button"
                                            className={cn(
                                                "grid size-8 place-items-center rounded-lg border transition",
                                                checked ? "border-violet-500 bg-violet-500 text-white shadow-[0_0_0_3px_rgba(139,92,246,.12)]" : "border-black/[0.14] text-transparent hover:border-violet-500/60 dark:border-white/[0.16]",
                                            )}
                                            aria-pressed={checked}
                                            aria-label={checked ? t("comfyuiLocal.import.unselectParameter", { name: field }) : t("comfyuiLocal.import.selectParameter", { name: field })}
                                            onClick={() => setItemSelected(item, !checked)}
                                        >
                                            {checked ? <Check className="size-4" /> : null}
                                        </button>
                                        <div className="min-w-0">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span className={cn("truncate text-[13px] font-medium", !checked && "text-stone-500 dark:text-zinc-400")}>{field}</span>
                                                {recommended ? <span className="shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">{t("comfyuiLocal.import.recommended")}</span> : null}
                                            </div>
                                            <div className="mt-1 font-mono text-[10px] text-stone-400 dark:text-zinc-600">{type}</div>
                                        </div>
                                        <Input
                                            value={labels[item.id] || ""}
                                            disabled={!checked}
                                            placeholder={t("comfyuiLocal.import.displayName")}
                                            onChange={(event) => onLabels({ ...labels, [item.id]: event.target.value })}
                                            aria-label={t("comfyuiLocal.import.displayName")}
                                        />
                                        <Tooltip title={t("comfyuiLocal.import.portExplanation")} placement="top">
                                            <label className={cn("flex items-center justify-end gap-2 text-[11px]", checked ? "text-stone-600 dark:text-zinc-300" : "text-stone-300 dark:text-zinc-700")}>
                                                <Switch size="small" checked={ports.has(item.id)} disabled={!checked} onChange={(value) => onPorts(toggle(ports, item.id, value))} />
                                                {t("comfyuiLocal.import.canvasPort")}
                                                <CircleHelp className="size-3" />
                                            </label>
                                        </Tooltip>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))}
                {!groups.length ? (
                    <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-black/[0.1] text-[12px] text-stone-400 dark:border-white/[0.1] dark:text-zinc-600">{t("comfyuiLocal.import.noMatchingNodeId")}</div>
                ) : null}
            </div>
        </div>
    );
}

function PreviewStep({
    name,
    description,
    onName,
    onDescription,
    inputs,
    outputs,
    ports,
    runnable,
}: {
    name: string;
    description: string;
    onName: (value: string) => void;
    onDescription: (value: string) => void;
    inputs: ComfyInspectedInput[];
    outputs: ComfyInspectedOutput[];
    ports: Set<string>;
    runnable: boolean;
}) {
    const { t } = useTranslation();
    return (
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
                <label className="block">
                    <span className="mb-2 block text-[10px] font-medium">{t("comfyuiLocal.import.workflowName")}</span>
                    <Input value={name} maxLength={80} onChange={(event) => onName(event.target.value)} />
                </label>
                <label className="block">
                    <span className="mb-2 block text-[10px] font-medium">{t("comfyuiLocal.import.workflowDescription")}</span>
                    <Input.TextArea value={description} maxLength={240} autoSize={{ minRows: 4, maxRows: 7 }} onChange={(event) => onDescription(event.target.value)} />
                </label>
                <div className={cn("border-l-2 px-3 py-2 text-[10px] leading-5", runnable ? "border-emerald-500 text-emerald-600 dark:text-emerald-300" : "border-amber-500 text-amber-600 dark:text-amber-300")}>
                    {t(runnable ? "comfyuiLocal.import.runnable" : "comfyuiLocal.import.draftOnly")}
                </div>
            </div>
            <div className="border border-black/[0.08] bg-black/[0.015] p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
                <div className="flex items-center gap-2 text-[11px] font-medium">
                    <FileJson className="size-4 text-violet-500" />
                    {name || t("comfyuiLocal.import.untitled")}
                </div>
                <div className="mt-4 grid gap-2 text-[9px] text-stone-500 dark:text-zinc-500">
                    <PreviewRows title={t("comfyuiLocal.import.inputs")} items={inputs.map((item) => ({ id: item.id, label: item.label }))} ports={ports} />
                    <PreviewRows title={t("comfyuiLocal.import.outputs")} items={outputs.map((item) => ({ id: item.id, label: item.outputName }))} ports={ports} />
                </div>
            </div>
        </div>
    );
}

function PreviewRows({ title, items, ports }: { title: string; items: Array<{ id: string; label: string }>; ports: Set<string> }) {
    return (
        <div>
            <div className="mb-1 uppercase tracking-[0.12em] text-stone-400">{title}</div>
            {items.map((item) => (
                <div key={item.id} className="flex justify-between border-b border-black/[0.05] py-1.5 last:border-0 dark:border-white/[0.05]">
                    <span>{item.label}</span>
                    <span>{ports.has(item.id) ? "PORT" : "VALUE"}</span>
                </div>
            ))}
        </div>
    );
}

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <div className="border-b border-black/[0.07] py-4 sm:border-b-0 sm:border-r sm:px-4 sm:last:border-r-0 dark:border-white/[0.07]">
            <dt className="text-[9px] uppercase tracking-[0.12em] text-stone-400">{label}</dt>
            <dd className="mt-2 text-lg font-semibold tabular-nums">{value}</dd>
        </div>
    );
}

function errorMessage(error: unknown) {
    if (error instanceof SyntaxError) return "JSON 文件内容无法解析";
    return error instanceof Error ? error.message : String(error);
}
