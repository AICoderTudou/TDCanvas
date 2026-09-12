import type { CSSProperties } from "react";
import { FileText, ImageIcon, Music2, UploadCloud, Video, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType } from "@/types/canvas";

const quickActions: Array<{ type: CanvasNodeType; label: "text" | "image" | "video" | "audio"; icon: LucideIcon }> = [
    { type: CanvasNodeType.Text, label: "text", icon: FileText },
    { type: CanvasNodeType.Image, label: "image", icon: ImageIcon },
    { type: CanvasNodeType.Video, label: "video", icon: Video },
    { type: CanvasNodeType.Audio, label: "audio", icon: Music2 },
];

export function CanvasEmptyGuide({ onCreate, onUploadMaterial }: { onCreate: (type: CanvasNodeType) => void; onUploadMaterial: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const guideStyle = {
        "--empty-guide-panel": theme.toolbar.panel,
        "--empty-guide-border": theme.toolbar.border,
        "--empty-guide-text": theme.toolbar.item,
        "--empty-guide-hover": theme.toolbar.itemHover,
        "--empty-guide-active": theme.toolbar.activeText,
        outlineColor: theme.node.activeStroke,
    } as CSSProperties;

    return (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" data-canvas-empty-guide>
            <div className="-translate-y-6 text-center">
                <p className="mb-3 text-xs font-medium tracking-wide" style={{ color: theme.node.faint }}>
                    {t("canvas.emptyGuide.hint")}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label={t("canvas.emptyGuide.quickActions")}>
                    {quickActions.map(({ type, label, icon: Icon }) => (
                        <button
                            key={type}
                            type="button"
                            className="pointer-events-auto flex h-9 items-center gap-2 rounded-full border bg-[var(--empty-guide-panel)] px-3.5 text-xs font-medium text-[var(--empty-guide-text)] opacity-80 backdrop-blur transition-[background-color,color,opacity,transform] duration-[160ms] ease-out hover:-translate-y-px hover:bg-[var(--empty-guide-hover)] hover:text-[var(--empty-guide-active)] hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                            style={guideStyle}
                            onClick={() => onCreate(type)}
                            onPointerDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                        >
                            <Icon className="size-3.5" aria-hidden="true" />
                            <span>{t(`canvas.emptyGuide.${label}`)}</span>
                        </button>
                    ))}
                    <button
                        type="button"
                        className="pointer-events-auto flex h-9 items-center gap-2 rounded-full border border-dashed bg-[var(--empty-guide-panel)] px-3.5 text-xs font-medium text-[var(--empty-guide-text)] opacity-80 backdrop-blur transition-[background-color,color,opacity,transform] duration-[160ms] ease-out hover:-translate-y-px hover:bg-[var(--empty-guide-hover)] hover:text-[var(--empty-guide-active)] hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        style={guideStyle}
                        onClick={onUploadMaterial}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                    >
                        <UploadCloud className="size-3.5" aria-hidden="true" />
                        <span>{t("canvas.material.uploadAction")}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
