import { X } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { closeCanvasTab, openCanvasTab } from "./canvas-workspace-tabs-model";

export function CanvasWorkspaceTabs({ activeProjectId }: { activeProjectId: string }) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const projects = useCanvasStore((state) => state.projects);
    const openProjectIds = useCanvasUiStore((state) => state.openProjectIds);
    const setOpenProjectIds = useCanvasUiStore((state) => state.setOpenProjectIds);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];

    useEffect(() => {
        const existing = new Set(projects.map((project) => project.id));
        const next = openCanvasTab(
            openProjectIds.filter((id) => existing.has(id)),
            activeProjectId,
        );
        if (next.length !== openProjectIds.length || next.some((id, index) => id !== openProjectIds[index])) setOpenProjectIds(next);
    }, [activeProjectId, openProjectIds, projects, setOpenProjectIds]);

    const byId = new Map(projects.map((project) => [project.id, project]));
    return (
        <nav className="pointer-events-auto absolute left-24 right-24 top-14 z-40 flex h-9 items-end gap-1 overflow-x-auto px-2" aria-label={t("canvas.tabs.label")}>
            {openProjectIds.map((projectId) => {
                const project = byId.get(projectId);
                if (!project) return null;
                const active = projectId === activeProjectId;
                return (
                    <div
                        key={projectId}
                        className="flex h-8 max-w-52 shrink-0 items-center rounded-t-lg border border-b-0 text-xs backdrop-blur-xl transition"
                        style={{ background: active ? theme.node.panel : theme.canvas.background, borderColor: active ? theme.toolbar.border : "transparent", color: active ? theme.node.text : theme.node.muted, opacity: active ? 1 : 0.78 }}
                    >
                        <button type="button" onClick={() => navigate(`/canvas/${projectId}`)} className="min-w-0 flex-1 truncate py-2 pl-3 text-left">
                            {project.title}
                        </button>
                        <button
                            type="button"
                            aria-label={t("canvas.tabs.close", { title: project.title })}
                            className="mr-2 grid size-4 shrink-0 place-items-center rounded opacity-50 transition hover:opacity-100"
                            onClick={(event) => {
                                const result = closeCanvasTab(openProjectIds, projectId, activeProjectId);
                                setOpenProjectIds(result.projectIds);
                                if (projectId === activeProjectId) navigate(result.nextProjectId ? `/canvas/${result.nextProjectId}` : "/canvas");
                            }}
                        >
                            <X className="size-3" />
                        </button>
                    </div>
                );
            })}
        </nav>
    );
}
