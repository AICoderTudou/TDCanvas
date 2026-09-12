import { GripHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasResizableAreaProps = {
    storageKey: string;
    defaultHeight: number;
    minHeight: number;
    maxHeight: number;
    resizeLabel: string;
    className?: string;
    children: ReactNode;
};

export function CanvasResizableArea({ storageKey, defaultHeight, minHeight, maxHeight, resizeLabel, className = "", children }: CanvasResizableAreaProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const areaRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef({ active: false, startY: 0, startHeight: defaultHeight, scale: 1 });
    const [height, setHeight] = useState(() => readStoredHeight(storageKey, defaultHeight, minHeight, maxHeight));
    const heightRef = useRef(height);
    heightRef.current = height;

    useEffect(() => {
        setHeight(readStoredHeight(storageKey, defaultHeight, minHeight, maxHeight));
    }, [defaultHeight, maxHeight, minHeight, storageKey]);

    useEffect(() => {
        const move = (event: PointerEvent) => {
            if (!dragRef.current.active) return;
            setHeight(clampHeight(dragRef.current.startHeight + (event.clientY - dragRef.current.startY) / dragRef.current.scale, minHeight, maxHeight));
        };
        const finish = () => {
            if (!dragRef.current.active) return;
            dragRef.current.active = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            try {
                window.localStorage.setItem(storageKey, String(Math.round(areaRef.current?.offsetHeight || heightRef.current)));
            } catch {
                // Resizing remains available when storage is unavailable.
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
    }, [maxHeight, minHeight, storageKey]);

    return (
        <div ref={areaRef} className={`relative min-w-0 overflow-hidden pb-3 ${className}`} style={{ height }} data-canvas-resizable-area>
            <div className="h-full min-h-0">{children}</div>
            <button
                type="button"
                className="absolute inset-x-0 bottom-0 z-20 flex h-3 cursor-ns-resize items-center justify-center opacity-45 transition hover:opacity-100 focus-visible:opacity-100"
                style={{ color: theme.node.muted }}
                aria-label={resizeLabel}
                title={resizeLabel}
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const area = areaRef.current;
                    const rect = area?.getBoundingClientRect();
                    dragRef.current = {
                        active: true,
                        startY: event.clientY,
                        startHeight: area?.offsetHeight || height,
                        scale: rect && area?.offsetHeight ? rect.height / area.offsetHeight : 1,
                    };
                    document.body.style.cursor = "ns-resize";
                    document.body.style.userSelect = "none";
                }}
            >
                <span className="flex h-2 w-14 items-center justify-center rounded-full transition hover:bg-white/[0.06]">
                    <GripHorizontal className="size-3.5" />
                </span>
            </button>
        </div>
    );
}

export function clampHeight(value: number, minHeight: number, maxHeight: number) {
    return Math.max(minHeight, Math.min(maxHeight, Math.round(value)));
}

function readStoredHeight(storageKey: string, fallback: number, minHeight: number, maxHeight: number) {
    try {
        const stored = Number(window.localStorage.getItem(storageKey));
        return Number.isFinite(stored) && stored > 0 ? clampHeight(stored, minHeight, maxHeight) : fallback;
    } catch {
        return fallback;
    }
}
