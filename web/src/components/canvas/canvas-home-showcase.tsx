import { useEffect, useRef } from "react";
import { Image as ImageIcon, Sparkles, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

import { CanvasProjectPreview } from "./canvas-project-preview";

const SCENE_PARTICLES = [
    [52, 14, 0.2, 7.2],
    [61, 22, 1.4, 8.4],
    [76, 10, 2.1, 6.8],
    [88, 28, 0.7, 9.2],
    [56, 48, 2.8, 7.8],
    [68, 60, 1.1, 8.8],
    [81, 51, 3.4, 7.4],
    [94, 67, 1.8, 9.6],
    [48, 76, 4.1, 8.2],
    [63, 87, 2.5, 7.1],
    [79, 81, 0.4, 8.9],
    [91, 91, 3.1, 7.6],
] as const;

type ShowcaseProject = Pick<CanvasProject, "id" | "title" | "nodes" | "connections">;

export function CanvasHomeShowcase({ project }: { project?: ShowcaseProject }) {
    const { t } = useTranslation();
    const sceneRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;
        let intersecting = true;
        const syncActivity = () => {
            scene.dataset.active = document.visibilityState === "visible" && intersecting ? "true" : "false";
        };
        const observer =
            typeof IntersectionObserver === "undefined"
                ? null
                : new IntersectionObserver(
                      ([entry]) => {
                          intersecting = entry?.isIntersecting ?? true;
                          syncActivity();
                      },
                      { rootMargin: "120px" },
                  );
        observer?.observe(scene);
        document.addEventListener("visibilitychange", syncActivity);
        syncActivity();
        return () => {
            observer?.disconnect();
            document.removeEventListener("visibilitychange", syncActivity);
        };
    }, []);

    const previewProject = project ?? { nodes: [], connections: [] };

    return (
        <div ref={sceneRef} data-canvas-home-showcase data-active="true" className="td-home-scene pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="td-home-scene-grid absolute inset-0" />
            <div className="td-home-scene-band absolute inset-0" />

            <svg className="td-home-scene-links absolute inset-0 size-full" viewBox="0 0 1000 380" preserveAspectRatio="xMidYMid slice">
                <defs>
                    <linearGradient id="td-home-scene-line" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0" stopColor="#756bff" stopOpacity="0" />
                        <stop offset="0.48" stopColor="#756bff" stopOpacity="0.8" />
                        <stop offset="1" stopColor="#a59eff" stopOpacity="0.12" />
                    </linearGradient>
                    <radialGradient id="td-home-scene-core">
                        <stop offset="0" stopColor="#d9d5ff" stopOpacity="0.95" />
                        <stop offset="0.26" stopColor="#8b82ff" stopOpacity="0.72" />
                        <stop offset="1" stopColor="#756bff" stopOpacity="0" />
                    </radialGradient>
                </defs>
                <g className="td-home-scene-orbits" fill="none">
                    <ellipse cx="774" cy="190" rx="206" ry="126" />
                    <ellipse cx="774" cy="190" rx="142" ry="86" />
                    <ellipse cx="774" cy="190" rx="78" ry="47" />
                </g>
                <g className="td-home-scene-link-base" fill="none">
                    <path d="M 188 111 C 370 111, 468 137, 610 145" />
                    <path d="M 290 286 C 438 284, 524 235, 624 218" />
                    <path d="M 606 145 C 690 126, 738 142, 786 189" />
                </g>
                <g className="td-home-scene-link-flow" fill="none">
                    <path d="M 188 111 C 370 111, 468 137, 610 145" />
                    <path d="M 290 286 C 438 284, 524 235, 624 218" />
                    <path d="M 606 145 C 690 126, 738 142, 786 189" />
                </g>
                <circle className="td-home-scene-core" cx="774" cy="190" r="36" fill="url(#td-home-scene-core)" />
                <circle className="td-home-scene-core-dot" cx="774" cy="190" r="2.8" fill="#d9d5ff" />
            </svg>

            {SCENE_PARTICLES.map(([left, top, delay, duration], index) => (
                <span
                    key={`${left}-${top}`}
                    className="td-home-scene-particle absolute size-1 rounded-full bg-[#8e85ff]"
                    style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s`, animationDuration: `${duration}s`, opacity: index % 3 === 0 ? 0.72 : 0.38 }}
                />
            ))}

            <div className="td-home-scene-node td-home-scene-prompt absolute">
                <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-zinc-500">
                    <Sparkles className="size-3 text-[#756bff]" />
                    {t("canvas.start.previewPrompt")}
                </div>
                <div className="mt-3 space-y-2" aria-hidden="true">
                    <span className="block h-px w-[84%] bg-current opacity-25" />
                    <span className="block h-px w-[64%] bg-current opacity-16" />
                    <span className="block h-px w-[42%] bg-current opacity-12" />
                </div>
            </div>

            <div className="td-home-scene-node td-home-scene-reference absolute flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-[10px] border border-[#756bff]/25 bg-[#756bff]/10 text-[#8e85ff]">
                    <ImageIcon className="size-3.5" />
                </span>
                <div>
                    <span className="block text-[9px] font-medium text-stone-500 dark:text-zinc-500">{t("canvas.start.previewReference")}</span>
                    <span className="mt-1 block h-px w-10 bg-current opacity-15" />
                </div>
            </div>

            <div className="td-home-scene-result absolute overflow-hidden" data-home-scene-project={project?.id ?? "empty"}>
                <div className="flex h-8 items-center justify-between border-b border-black/[0.07] px-3 dark:border-white/[0.07]">
                    <span className="flex min-w-0 items-center gap-2 text-[9px] font-medium text-stone-500 dark:text-zinc-400">
                        <Video className="size-3 shrink-0" />
                        <span className="truncate">{project?.title || t("canvas.empty")}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[8px] uppercase tracking-[0.12em] text-stone-400 dark:text-zinc-600">
                        <i className="size-1 rounded-full bg-[#756bff] shadow-[0_0_8px_rgba(117,107,255,0.9)]" />
                        live
                    </span>
                </div>
                <div className="td-home-scene-result-preview relative min-h-0 flex-1 overflow-hidden">
                    <CanvasProjectPreview project={previewProject} />
                </div>
                <span className="td-home-scene-corner td-home-scene-corner-tl" />
                <span className="td-home-scene-corner td-home-scene-corner-br" />
            </div>

            <div className="td-home-scene-coordinates absolute flex items-center gap-4 text-[8px] font-medium tracking-[0.18em] text-stone-400/70 dark:text-zinc-600/80">
                <span>∞ / 2048</span>
                <span>X 072</span>
                <span>Y 118</span>
            </div>
        </div>
    );
}
