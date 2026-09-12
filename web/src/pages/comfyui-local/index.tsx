import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { App, Button } from "antd";
import { AlertCircle, ArrowRight, ChevronDown, CircleStop, Cpu, FileJson, FolderOpen, LoaderCircle, Play, Plus, RefreshCw, TerminalSquare, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { comfyNativeClient, type ComfyEnvironmentDetection, type ComfyEnvironmentLogEntry, type ComfyEnvironmentProfile, type ComfyEnvironmentStatus, type ComfyWorkflowDefinition } from "@/integrations/comfyui-local";
import { createComfyWorkflowCanvasNode } from "@/integrations/comfyui-local/canvas-node";
import { createComfyResultNodes } from "@/integrations/comfyui-local/result-nodes";
import { ComfyWorkflowImportWizard } from "@/integrations/comfyui-local/workflow-import-wizard";
import { deleteComfyWorkflowDefinition, listComfyWorkflowDefinitions } from "@/integrations/comfyui-local/workflow-library";
import { cn } from "@/lib/utils";
import { isTauriRuntime } from "@/services/platform/desktop-runtime";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

const EMPTY_STATUS: ComfyEnvironmentStatus = { phase: "idle" };

export default function ComfyUiLocalPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const createProject = useCanvasStore((state) => state.createProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const desktop = isTauriRuntime();
    const [profile, setProfile] = useState<ComfyEnvironmentProfile | null>(null);
    const [status, setStatus] = useState<ComfyEnvironmentStatus>(EMPTY_STATUS);
    const [logs, setLogs] = useState<ComfyEnvironmentLogEntry[]>([]);
    const [detection, setDetection] = useState<ComfyEnvironmentDetection | null>(null);
    const [selectedRoot, setSelectedRoot] = useState("");
    const [editing, setEditing] = useState(false);
    const [loading, setLoading] = useState(desktop);
    const [detecting, setDetecting] = useState(false);
    const [action, setAction] = useState<"start" | "stop" | null>(null);
    const [workflows, setWorkflows] = useState<ComfyWorkflowDefinition[]>([]);
    const [importOpen, setImportOpen] = useState(false);

    const refreshRuntime = useCallback(async () => {
        if (!desktop) return;
        const [nextStatus, nextLogs] = await Promise.all([comfyNativeClient.status(), comfyNativeClient.logs()]);
        setStatus(nextStatus);
        setLogs(nextLogs);
    }, [desktop]);

    useEffect(() => {
        let disposed = false;
        const unlisten: UnlistenFn[] = [];
        const initialize = async () => {
            try {
                const saved = desktop ? await comfyNativeClient.savedEnvironments() : { profiles: [], activeProfileId: undefined };
                const savedProfile = saved.profiles.find((item) => item.id === saved.activeProfileId) || saved.profiles[0] || null;
                if (!disposed) setProfile(savedProfile);
                if (desktop) await refreshRuntime();
                if (!desktop) return;
                const statusUnlisten = await listen<ComfyEnvironmentStatus>("comfyui-local://status", ({ payload }) => {
                    if (!disposed) setStatus(payload);
                });
                if (disposed) statusUnlisten();
                else unlisten.push(statusUnlisten);
                const logUnlisten = await listen<ComfyEnvironmentLogEntry>("comfyui-local://log", ({ payload }) => {
                    if (!disposed) setLogs((current) => [...current.slice(-999), payload]);
                });
                if (disposed) logUnlisten();
                else unlisten.push(logUnlisten);
            } catch (error) {
                if (!disposed) message.error(errorMessage(error));
            } finally {
                if (!disposed) setLoading(false);
            }
        };
        void initialize();
        return () => {
            disposed = true;
            unlisten.forEach((dispose) => dispose());
        };
    }, [desktop, message, refreshRuntime]);

    useEffect(() => {
        let disposed = false;
        void listComfyWorkflowDefinitions()
            .then((items) => {
                if (!disposed) setWorkflows(items);
            })
            .catch((error) => {
                if (!disposed) message.error(errorMessage(error));
            });
        return () => {
            disposed = true;
        };
    }, [message]);

    const running = status.phase === "running";
    const busy = status.phase === "starting" || action !== null;
    const setupMode = !profile || editing;
    const recentLogs = useMemo(() => logs.slice(-80), [logs]);

    const inspectEnvironment = async (selectPython = false) => {
        setDetecting(true);
        setDetection(null);
        try {
            const result = selectPython ? await comfyNativeClient.selectEnvironmentPython() : await comfyNativeClient.selectEnvironment();
            if (!result) return null;
            setDetection(result);
            setSelectedRoot(result.selectedRoot);
            return result;
        } catch (error) {
            message.error(errorMessage(error));
            return null;
        } finally {
            setDetecting(false);
        }
    };

    const chooseRootDirectory = async () => {
        if (!desktop) return;
        await inspectEnvironment();
    };

    const choosePython = async () => {
        if (!selectedRoot) return;
        await inspectEnvironment(true);
    };

    const useEnvironment = async (nextProfile: ComfyEnvironmentProfile, startAfterSave: boolean) => {
        const active = status.phase === "running" || status.phase === "starting";
        const switching = Boolean(profile && profile.id !== nextProfile.id);
        if (switching && active) {
            setAction("stop");
            try {
                setStatus(await comfyNativeClient.stopEnvironment());
            } catch (error) {
                message.error(errorMessage(error));
                return;
            } finally {
                setAction(null);
            }
        }
        setProfile(nextProfile);
        setEditing(false);
        message.success(t("comfyuiLocal.setup.saved"));
        if (startAfterSave && !(active && !switching)) await startEnvironment(nextProfile);
    };

    const saveEnvironment = async () => {
        const nextProfile = detection?.profile;
        if (!nextProfile || !detection.ready) return;
        await useEnvironment(nextProfile, true);
    };

    const startEnvironment = async (target = profile) => {
        if (!target) return;
        setAction("start");
        try {
            const result = await comfyNativeClient.startEnvironment(target.id);
            setStatus(result.status);
            message.success(t("comfyuiLocal.runtime.starting"));
        } catch (error) {
            message.error(errorMessage(error));
            await refreshRuntime().catch(() => undefined);
        } finally {
            setAction(null);
        }
    };

    const stopEnvironment = async () => {
        setAction("stop");
        try {
            setStatus(await comfyNativeClient.stopEnvironment());
            message.success(t("comfyuiLocal.runtime.stopped"));
        } catch (error) {
            message.error(errorMessage(error));
        } finally {
            setAction(null);
        }
    };

    const changeEnvironment = async () => {
        if (!desktop || busy) return;
        const result = await inspectEnvironment();
        if (!result) return;
        if (!result.profile || !result.ready) {
            setEditing(true);
            return;
        }
        await useEnvironment(result.profile, true);
    };

    const forgetEnvironment = async () => {
        if (running || status.phase === "starting") return;
        if (profile) await comfyNativeClient.removeEnvironment(profile.id);
        setProfile(null);
        setDetection(null);
        setSelectedRoot("");
        setEditing(false);
    };

    const addWorkflowToCanvas = (definition: ComfyWorkflowDefinition) => {
        const state = useCanvasStore.getState();
        const project = [...state.projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        const projectId = project?.id || createProject(definition.name);
        const target = useCanvasStore.getState().openProject(projectId);
        if (!target) return;
        const viewport = target.viewport;
        const position = {
            x: (Math.max(900, window.innerWidth) / 2 - viewport.x) / viewport.k,
            y: (Math.max(640, window.innerHeight) / 2 - viewport.y) / viewport.k,
        };
        const workflowNode = createComfyWorkflowCanvasNode(definition, position);
        const resultGraph = createComfyResultNodes(workflowNode, definition);
        updateProject(projectId, {
            nodes: [...target.nodes, workflowNode, ...resultGraph.nodes],
            connections: [...target.connections, ...resultGraph.connections],
        });
        navigate(`/canvas/${projectId}`);
    };

    const removeWorkflow = (definition: ComfyWorkflowDefinition) => {
        modal.confirm({
            title: t("comfyuiLocal.library.deleteTitle"),
            content: t("comfyuiLocal.library.deleteDescription", { name: definition.name }),
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: async () => {
                await deleteComfyWorkflowDefinition(definition.id);
                setWorkflows((current) => current.filter((item) => item.id !== definition.id));
            },
        });
    };

    return (
        <WorkspacePage icon={Cpu} title={t("comfyuiLocal.title")} actions={<RuntimePill status={status} />}>
            <div className="mx-auto max-w-[1080px]">
                {!desktop ? (
                    <section className="border-y border-amber-500/20 bg-amber-500/[0.04] px-5 py-8 sm:px-8">
                        <div className="flex items-start gap-4">
                            <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-500" />
                            <div>
                                <h2 className="text-[15px] font-semibold">{t("comfyuiLocal.desktopOnly.title")}</h2>
                                <p className="mt-2 max-w-2xl text-[12px] leading-6 text-stone-500 dark:text-zinc-400">{t("comfyuiLocal.desktopOnly.description")}</p>
                            </div>
                        </div>
                    </section>
                ) : loading ? (
                    <div className="grid min-h-[320px] place-items-center text-stone-400 dark:text-zinc-600">
                        <LoaderCircle className="size-5 animate-spin" />
                    </div>
                ) : setupMode ? (
                    <EnvironmentSetup
                        detection={detection}
                        selectedRoot={selectedRoot}
                        detecting={detecting}
                        onChooseRoot={chooseRootDirectory}
                        onChoosePython={choosePython}
                        onSaveAndStart={() => void saveEnvironment()}
                        onCancel={profile ? () => setEditing(false) : undefined}
                    />
                ) : (
                    <EnvironmentRuntime
                        profile={profile}
                        status={status}
                        logs={recentLogs}
                        busy={busy}
                        onStart={() => void startEnvironment()}
                        onStop={() => void stopEnvironment()}
                        onRefresh={() => void refreshRuntime().catch((error) => message.error(errorMessage(error)))}
                        onChangeEnvironment={() => void changeEnvironment()}
                        onForget={() => void forgetEnvironment()}
                        workflows={workflows}
                        onImport={() => setImportOpen(true)}
                        onAddToCanvas={addWorkflowToCanvas}
                        onDeleteWorkflow={removeWorkflow}
                    />
                )}
            </div>
            {profile ? (
                <ComfyWorkflowImportWizard
                    open={importOpen}
                    environment={profile}
                    onClose={() => setImportOpen(false)}
                    onSaved={(definition) => {
                        setWorkflows((current) => [definition, ...current.filter((item) => item.id !== definition.id)]);
                        setImportOpen(false);
                    }}
                />
            ) : null}
        </WorkspacePage>
    );
}

type SetupProps = {
    detection: ComfyEnvironmentDetection | null;
    selectedRoot: string;
    detecting: boolean;
    onChooseRoot: () => void;
    onChoosePython: () => void;
    onSaveAndStart: () => void;
    onCancel?: () => void;
};

function EnvironmentSetup({ detection, selectedRoot, detecting, onChooseRoot, onChoosePython, onSaveAndStart, onCancel }: SetupProps) {
    const { t } = useTranslation();
    return (
        <section className="py-8 sm:py-12">
            <div className="mb-7 flex items-end justify-between gap-4">
                <div>
                    <h2 className="text-[26px] font-semibold tracking-[-0.035em]">{onCancel ? t("comfyuiLocal.setup.changeTitle") : t("comfyuiLocal.setup.title")}</h2>
                    <p className="mt-2 text-[13px] text-stone-500 dark:text-zinc-500">{t("comfyuiLocal.setup.shortHint")}</p>
                </div>
                {onCancel ? (
                    <Button type="text" onClick={onCancel}>
                        {t("common.cancel")}
                    </Button>
                ) : null}
            </div>

            <div className="min-w-0 border-y border-black/[0.08] dark:border-white/[0.08]">
                <div className="py-6">
                    <button
                        type="button"
                        className="group flex min-h-28 w-full cursor-pointer items-center gap-5 border border-dashed border-black/[0.16] px-5 text-left transition hover:border-violet-500/55 hover:bg-violet-500/[0.025] dark:border-white/[0.14] sm:px-6"
                        onClick={onChooseRoot}
                    >
                        <span className="grid size-12 shrink-0 place-items-center bg-black/[0.04] text-stone-500 transition group-hover:text-violet-500 dark:bg-white/[0.05] dark:text-zinc-400">
                            {detecting ? <LoaderCircle className="size-5 animate-spin" /> : <FolderOpen className="size-5" />}
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate text-[15px] font-medium" title={selectedRoot || undefined}>
                                {selectedRoot || t("comfyuiLocal.setup.selectRoot")}
                            </span>
                        </span>
                    </button>

                    {detection ? (
                        <div className="mt-6 border-t border-black/[0.07] pt-6 dark:border-white/[0.07]">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2.5 text-[14px] font-medium">
                                    <span className={cn("size-2 rounded-full", detection.ready ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" : "bg-amber-500")} />
                                    {detection.ready ? t("comfyuiLocal.setup.detected") : t("comfyuiLocal.setup.needsAttention")}
                                </div>
                                {detection.profile ? <span className="text-[11px] text-stone-400 dark:text-zinc-600">{t(`comfyuiLocal.installKind.${detection.profile.installKind}`)}</span> : null}
                            </div>
                            {detection.profile ? (
                                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                                    <PathDetail label="main.py" value={detection.profile.mainPyPath} />
                                    <PathDetail label="Python" value={detection.profile.pythonPath} />
                                </dl>
                            ) : null}
                            {detection.issues.length ? (
                                <div className="mt-5 border-l-2 border-amber-500/50 bg-amber-500/[0.045] px-4 py-3 text-[12px] leading-6 text-amber-700 dark:text-amber-300/80">
                                    {detection.issues.map((issue) => (
                                        <div key={issue}>{issue}</div>
                                    ))}
                                    <button type="button" className="mt-2 cursor-pointer font-medium text-amber-700 underline decoration-amber-500/40 underline-offset-4 dark:text-amber-300" onClick={onChoosePython}>
                                        {t("comfyuiLocal.setup.selectPython")}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <div className="flex justify-end border-t border-black/[0.07] py-5 dark:border-white/[0.07]">
                    <Button type="primary" size="large" onClick={onSaveAndStart} disabled={!detection?.ready} loading={detecting}>
                        {t("comfyuiLocal.setup.saveAndStart")}
                    </Button>
                </div>
            </div>
        </section>
    );
}

type RuntimeProps = {
    profile: ComfyEnvironmentProfile;
    status: ComfyEnvironmentStatus;
    logs: ComfyEnvironmentLogEntry[];
    busy: boolean;
    onStart: () => void;
    onStop: () => void;
    onRefresh: () => void;
    onChangeEnvironment: () => void;
    onForget: () => void;
    workflows: ComfyWorkflowDefinition[];
    onImport: () => void;
    onAddToCanvas: (definition: ComfyWorkflowDefinition) => void;
    onDeleteWorkflow: (definition: ComfyWorkflowDefinition) => void;
};

function EnvironmentRuntime({ profile, status, logs, busy, onStart, onStop, onRefresh, onChangeEnvironment, onForget, workflows, onImport, onAddToCanvas, onDeleteWorkflow }: RuntimeProps) {
    const { t } = useTranslation();
    const active = status.phase === "running" || status.phase === "starting";
    return (
        <section className="py-7 sm:py-9">
            <div className="flex flex-col justify-between gap-6 border-b border-black/[0.08] pb-7 dark:border-white/[0.08] sm:flex-row sm:items-start">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="truncate text-[28px] font-semibold tracking-[-0.04em]">{profile.name}</h2>
                        <span className="text-[12px] text-stone-400 dark:text-zinc-600">{t(`comfyuiLocal.installKind.${profile.installKind}`)}</span>
                    </div>
                    <p className="mt-2 truncate text-[13px] text-stone-400 dark:text-zinc-600" title={profile.rootDirectory}>
                        {profile.rootDirectory}
                    </p>
                    {status.message ? <p className="mt-3 max-w-2xl text-[12px] leading-5 text-amber-600 dark:text-amber-300/80">{status.message}</p> : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                    <Button icon={<FolderOpen className="size-4" />} onClick={onChangeEnvironment} disabled={busy}>
                        {t("comfyuiLocal.runtime.change")}
                    </Button>
                    <Button icon={<RefreshCw className="size-3.5" />} onClick={onRefresh} disabled={busy}>
                        {t("comfyuiLocal.runtime.refresh")}
                    </Button>
                    {active ? (
                        <Button danger icon={<CircleStop className="size-3.5" />} onClick={onStop} loading={busy}>
                            {t("comfyuiLocal.runtime.stop")}
                        </Button>
                    ) : (
                        <Button type="primary" icon={<Play className="size-3.5" />} onClick={onStart} loading={busy}>
                            {t("comfyuiLocal.runtime.start")}
                        </Button>
                    )}
                </div>
            </div>

            <dl className="grid border-b border-black/[0.08] dark:border-white/[0.08] sm:grid-cols-3">
                <RuntimeDetail label={t("comfyuiLocal.runtime.state")} value={t(`comfyuiLocal.phase.${status.phase}`)} />
                <RuntimeDetail label={t("comfyuiLocal.runtime.port")} value={status.port ? `127.0.0.1:${status.port}` : "—"} />
                <RuntimeDetail label="PID" value={status.pid ? String(status.pid) : "—"} />
            </dl>

            <details className="group border-b border-black/[0.07] dark:border-white/[0.07]">
                <summary className="flex h-14 cursor-pointer list-none items-center justify-between text-[13px] font-medium">
                    <span className="flex items-center gap-2">
                        <TerminalSquare className="size-4 text-stone-400" />
                        {t("comfyuiLocal.logs.title")}
                        <span className="text-[11px] font-normal tabular-nums text-stone-400 dark:text-zinc-600">{logs.length}</span>
                    </span>
                    <ChevronDown className="size-3.5 text-stone-400 transition group-open:rotate-180" />
                </summary>
                <div className="mb-6 max-h-[320px] overflow-auto bg-[#0b0d10] p-4 font-mono text-[10px] leading-5 text-zinc-400">
                    {logs.length ? (
                        logs.map((entry, index) => (
                            <div key={`${entry.timestamp}-${index}`} className={entry.stream === "stderr" ? "text-amber-300/80" : undefined}>
                                <span className="mr-3 text-zinc-700">{formatLogTime(entry.timestamp)}</span>
                                {entry.message}
                            </div>
                        ))
                    ) : (
                        <div className="text-zinc-600">{t("comfyuiLocal.logs.empty")}</div>
                    )}
                </div>
            </details>

            <section className="py-8">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h3 className="text-[20px] font-semibold tracking-[-0.03em]">{t("comfyuiLocal.library.title")}</h3>
                    </div>
                    <Button type="primary" size="large" icon={<Plus className="size-4" />} onClick={onImport} disabled={status.phase !== "running"}>
                        {t("comfyuiLocal.library.import")}
                    </Button>
                </div>
                {workflows.length ? (
                    <div className="mt-6 divide-y divide-black/[0.07] border-y border-black/[0.08] dark:divide-white/[0.07] dark:border-white/[0.08]">
                        {workflows.map((workflow) => (
                            <div key={workflow.id} className="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                <div className="flex min-w-0 items-start gap-3">
                                    <span className="grid size-10 shrink-0 place-items-center bg-violet-500/[0.08] text-violet-500">
                                        <FileJson className="size-[18px]" />
                                    </span>
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                            <span className="truncate text-[14px] font-medium">{workflow.name}</span>
                                            <span className={cn("size-1.5 rounded-full", workflow.dependencySnapshot.runnable ? "bg-emerald-500" : "bg-amber-500")} />
                                        </div>
                                        <p className="mt-1 truncate text-[11px] text-stone-400 dark:text-zinc-600">
                                            {workflow.inputs.length} inputs · {workflow.outputs.length} outputs · {workflow.workflowHash.slice(0, 8)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex justify-end gap-1">
                                    <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => onDeleteWorkflow(workflow)} aria-label={t("common.delete")} />
                                    <Button size="small" icon={<ArrowRight className="size-3.5" />} onClick={() => onAddToCanvas(workflow)}>
                                        {t("comfyuiLocal.library.addToCanvas")}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="mt-6 flex min-h-32 items-center justify-center border-y border-dashed border-black/[0.1] text-center text-[13px] leading-6 text-stone-400 dark:border-white/[0.1] dark:text-zinc-600">
                        {status.phase === "running" ? t("comfyuiLocal.library.empty") : t("comfyuiLocal.library.startFirst")}
                    </div>
                )}
            </section>
            {!active ? (
                <button type="button" className="cursor-pointer text-[11px] text-stone-400 transition hover:text-red-500 dark:text-zinc-600" onClick={onForget}>
                    {t("comfyuiLocal.runtime.forget")}
                </button>
            ) : null}
        </section>
    );
}

function RuntimePill({ status }: { status: ComfyEnvironmentStatus }) {
    const { t } = useTranslation();
    const tone = status.phase === "running" ? "bg-emerald-500" : status.phase === "starting" ? "animate-pulse bg-violet-500" : status.phase === "failed" ? "bg-red-500" : "bg-stone-300 dark:bg-zinc-700";
    return (
        <div className="flex h-9 items-center gap-2.5 border border-black/[0.08] px-3.5 text-[12px] font-medium text-stone-500 dark:border-white/[0.08] dark:text-zinc-400">
            <span className={cn("size-1.5 rounded-full", tone)} />
            {t(`comfyuiLocal.phase.${status.phase}`)}
        </div>
    );
}

function RuntimeDetail({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 py-6 sm:border-r sm:border-black/[0.07] sm:px-5 sm:first:pl-0 sm:last:border-r-0 dark:sm:border-white/[0.07]">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-stone-400 dark:text-zinc-600">{label}</dt>
            <dd className="mt-2 truncate text-[16px] font-medium tabular-nums" title={value}>
                {value}
            </dd>
        </div>
    );
}

function PathDetail({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-stone-400 dark:text-zinc-600">{label}</dt>
            <dd className="mt-1.5 truncate text-[12px] text-stone-600 dark:text-zinc-400" title={value}>
                {value}
            </dd>
        </div>
    );
}

function formatLogTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
