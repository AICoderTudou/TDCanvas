import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Download, Plus, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasHomeShowcase } from "@/components/canvas/canvas-home-showcase";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { latestCanvasProjectId, sortCanvasProjectsByRecent } from "@/lib/canvas/canvas-home";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export default function CanvasPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const autoOpenRef = useRef(false);
    const pointerFrameRef = useRef<number | null>(null);
    const pointerPositionRef = useRef({ x: 0, y: 0, root: null as HTMLElement | null });
    const reducedMotion = useReducedMotion();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const sortedProjects = useMemo(() => sortCanvasProjectsByRecent(projects), [projects]);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => navigate(`/canvas/${id}${agentQuery}`);
    const createAndEnter = () => enterProject(createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        const targetId = mode === "new" ? createProject(t("canvas.defaultTitle", { count: projects.length + 1 })) : latestCanvasProjectId(projects) || createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
        enterProject(targetId);
    }, [createProject, hydrated, mode, projects, t]);

    useEffect(
        () => () => {
            if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
        },
        [],
    );

    if (hydrated && (mode === "new" || mode === "recent")) {
        return (
            <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">
                <span className="mr-2 size-1.5 animate-pulse rounded-full bg-[#756bff]" />
                {t("canvas.opening")}
            </main>
        );
    }

    const contentMotion = (delay: number) =>
        reducedMotion
            ? {}
            : {
                  initial: { y: 12 },
                  animate: { y: 0 },
                  transition: { duration: 0.42, delay, ease: [0.22, 1, 0.36, 1] as const },
              };

    const updatePointerAtmosphere = (event: ReactPointerEvent<HTMLElement>) => {
        if (reducedMotion || (typeof window !== "undefined" && !window.matchMedia("(pointer: fine)").matches)) return;
        pointerPositionRef.current = { x: event.clientX, y: event.clientY, root: event.currentTarget };
        if (pointerFrameRef.current !== null) return;
        pointerFrameRef.current = requestAnimationFrame(() => {
            pointerFrameRef.current = null;
            const { x, y, root } = pointerPositionRef.current;
            if (!root) return;
            const rect = root.getBoundingClientRect();
            const normalizedX = Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width)));
            const normalizedY = Math.max(0, Math.min(1, (y - rect.top) / Math.max(1, rect.height)));
            root.style.setProperty("--td-home-pointer-x", `${normalizedX * 100}%`);
            root.style.setProperty("--td-home-pointer-y", `${normalizedY * 100}%`);
            root.style.setProperty("--td-home-drift-x", `${(normalizedX - 0.5) * 10}px`);
            root.style.setProperty("--td-home-drift-y", `${(normalizedY - 0.5) * 8}px`);
        });
    };

    const resetPointerAtmosphere = (event: ReactPointerEvent<HTMLElement>) => {
        event.currentTarget.style.setProperty("--td-home-pointer-x", "74%");
        event.currentTarget.style.setProperty("--td-home-pointer-y", "28%");
        event.currentTarget.style.setProperty("--td-home-drift-x", "0px");
        event.currentTarget.style.setProperty("--td-home-drift-y", "0px");
    };

    return (
        <main
            data-canvas-home
            className="td-home-shell relative h-full min-h-0 overflow-y-auto overflow-x-hidden bg-[#f4f2ed] text-stone-950 dark:bg-[#090a0b] dark:text-zinc-100"
            onPointerMove={updatePointerAtmosphere}
            onPointerLeave={resetPointerAtmosphere}
        >
            <div className="td-home-page-grid pointer-events-none fixed inset-0" aria-hidden="true" />
            <div className="td-home-page-glow pointer-events-none fixed inset-0" aria-hidden="true" />

            <div className="td-home-content relative z-[1] mx-auto w-full max-w-[1440px]">
                <section className="td-home-hero relative flex items-center overflow-hidden border-b border-black/[0.08] dark:border-white/[0.07]">
                    <CanvasHomeShowcase project={sortedProjects[0]} />

                    <motion.div {...contentMotion(0.02)} className="td-home-hero-copy relative z-10 max-w-[650px]">
                        <div className="td-home-kicker flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-zinc-500">
                            <span className="h-px w-8 bg-[#756bff] shadow-[0_0_10px_rgba(117,107,255,0.65)]" />
                            <span>TD / WORKSPACE</span>
                            {hydrated ? <span className="normal-case tracking-normal text-stone-400 dark:text-zinc-600">{t("canvas.start.workspaceStatus", { count: projects.length })}</span> : null}
                        </div>
                        <h1 className="td-home-headline max-w-[620px] font-semibold leading-[1.02] tracking-[-0.05em] text-stone-950 dark:text-[#f5f5f6]">{t("canvas.start.headline")}</h1>
                        <p className="td-home-description max-w-[580px] text-[14px] leading-6 text-stone-600 dark:text-zinc-400">{t("canvas.start.description")}</p>

                        <div className="td-home-actions flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                disabled={!hydrated}
                                className="td-home-primary-action group inline-flex h-12 cursor-pointer items-center gap-3 rounded-[14px] px-5 text-[13px] font-semibold outline-none transition duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#a59eff] disabled:cursor-not-allowed disabled:opacity-45"
                                onClick={createAndEnter}
                            >
                                <Plus className="size-4" />
                                {t("canvas.create")}
                                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                            </button>
                        </div>
                    </motion.div>
                </section>

                <motion.section {...contentMotion(0.1)} className="td-home-recent" aria-labelledby="recent-canvases-title">
                    <div className="td-home-recent-header flex min-w-0 flex-wrap items-end justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-4">
                            <span className="pt-1 text-[10px] font-semibold tabular-nums tracking-[0.18em] text-[#756bff]">01</span>
                            <div className="min-w-0">
                                <h2 id="recent-canvases-title" className="text-xl font-semibold tracking-[-0.025em] text-stone-900 dark:text-zinc-100">
                                    {t("canvas.start.recentTitle")}
                                </h2>
                                <p className="mt-1.5 text-[11px] text-stone-500 dark:text-zinc-500">{t("canvas.start.recentDescription")}</p>
                            </div>
                        </div>

                        {selectedIds.length ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-full border border-black/[0.08] bg-white/55 p-1.5 pl-3 text-[11px] text-stone-500 backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-400">
                                <span className="mr-1">{t("canvas.start.selectedCount", { count: selectedIds.length })}</span>
                                <button
                                    type="button"
                                    className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-stone-600 transition hover:bg-black/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.07]"
                                    onClick={() =>
                                        void exportCanvasProjects(
                                            projects.filter((project) => selectedIds.includes(project.id)),
                                            `${t("canvas.title")}-${selectedIds.length}`,
                                        )
                                    }
                                >
                                    <Download className="size-3.5" />
                                    {t("canvas.exportSelected")}
                                </button>
                                <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-red-500 transition hover:bg-red-500/10 dark:text-red-400" onClick={() => setDeleteIds(selectedIds)}>
                                    <Trash2 className="size-3.5" />
                                    {t("canvas.deleteSelected")}
                                </button>
                            </div>
                        ) : projects.length ? (
                            <button
                                type="button"
                                disabled={!hydrated}
                                className="cursor-pointer text-[11px] text-stone-400 transition hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-45 dark:text-zinc-600 dark:hover:text-red-400"
                                onClick={() => setDeleteIds(projects.map((project) => project.id))}
                            >
                                {t("canvas.deleteAll")}
                            </button>
                        ) : null}
                    </div>

                    {!hydrated ? (
                        <CanvasHomeLoading />
                    ) : sortedProjects.length ? (
                        <div className="td-home-project-grid grid gap-4">
                            {sortedProjects.map((project, index) => (
                                <CanvasProjectCard key={project.id} project={project} index={index} />
                            ))}
                        </div>
                    ) : (
                        <section className="td-home-empty flex min-h-[190px] items-center gap-5 border-y border-black/[0.07] py-8 dark:border-white/[0.07]">
                            <div className="relative grid size-14 shrink-0 place-items-center rounded-[18px] border border-black/[0.09] text-stone-400 dark:border-white/[0.09] dark:text-zinc-600">
                                <span className="h-px w-5 bg-current" />
                                <span className="absolute h-5 w-px bg-current" />
                            </div>
                            <div>
                                <h3 className="text-[14px] font-semibold text-stone-800 dark:text-zinc-200">{t("canvas.empty")}</h3>
                                <p className="mt-1.5 max-w-md text-[11px] leading-5 text-stone-500 dark:text-zinc-500">{t("canvas.emptyDescription")}</p>
                            </div>
                            <span className="hidden h-px flex-1 bg-black/[0.07] dark:bg-white/[0.07] sm:block" aria-hidden="true" />
                        </section>
                    )}
                </motion.section>
            </div>

            <CanvasDeleteProjectsDialog />
        </main>
    );
}

function CanvasHomeLoading() {
    return (
        <div data-canvas-home-loading className="td-home-project-grid grid gap-4" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
                <div key={index}>
                    <div className="aspect-[16/9] animate-pulse rounded-[16px] border border-black/[0.06] bg-black/[0.035] dark:border-white/[0.06] dark:bg-white/[0.03]" />
                    <div className="space-y-3 pt-3.5">
                        <div className="h-3 w-2/3 animate-pulse rounded-full bg-black/[0.07] dark:bg-white/[0.06]" />
                        <div className="h-2 w-1/3 animate-pulse rounded-full bg-black/[0.05] dark:bg-white/[0.04]" />
                    </div>
                </div>
            ))}
        </div>
    );
}
