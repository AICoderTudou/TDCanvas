import React, { useEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

type TDCanvasSurfaceProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function TDCanvasSurface({ containerRef, viewport, backgroundMode = "dots", onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: TDCanvasSurfaceProps) {
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
    });
    const scaleRef = useRef(viewport.k);
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const ambientFrameRef = useRef<number | null>(null);
    const ambientPointerRef = useRef<{ element: HTMLDivElement; x: number; y: number } | null>(null);
    const [isSpacePressed, setIsSpacePressed] = useState(false);

    useEffect(() => {
        scaleRef.current = viewport.k;
    }, [viewport.k]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            if (ambientFrameRef.current) cancelAnimationFrame(ambientFrameRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") setIsSpacePressed(false);
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        const delta = -event.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(viewport.k * factor, 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - viewport.x) / viewport.k;
        const worldY = (mouseY - viewport.y) / viewport.k;

        onViewportChange({
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        });
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");

        if (event.button === 0 && (event.ctrlKey || event.metaKey) && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
            return;
        }

        if (event.button === 1 || (event.button === 0 && !isSpacePressed && isBackgroundClick)) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: viewport.x,
                initialY: viewport.y,
                hasMoved: false,
            };
            event.currentTarget.dataset.canvasPanning = "true";
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isSpacePressed && isBackgroundClick) {
            event.preventDefault();
        }
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    const handleAmbientPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        ambientPointerRef.current = {
            element: event.currentTarget,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
        if (ambientFrameRef.current) return;
        ambientFrameRef.current = requestAnimationFrame(() => {
            ambientFrameRef.current = null;
            const pointer = ambientPointerRef.current;
            if (!pointer) return;
            pointer.element.style.setProperty("--td-pointer-x", `${pointer.x}px`);
            pointer.element.style.setProperty("--td-pointer-y", `${pointer.y}px`);
        });
    };

    const resetAmbientPointer = (event: React.PointerEvent<HTMLDivElement>) => {
        if (ambientFrameRef.current) {
            cancelAnimationFrame(ambientFrameRef.current);
            ambientFrameRef.current = null;
        }
        ambientPointerRef.current = null;
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--td-pointer-x", `${rect.width / 2}px`);
        event.currentTarget.style.setProperty("--td-pointer-y", `${rect.height / 2}px`);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            nextViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: scaleRef.current,
            };
            if (frameRef.current) return;
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
            });
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;

            if (!panState.current.hasMoved) {
                onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            containerRef.current?.removeAttribute("data-canvas-panning");
            document.body.style.cursor = "";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [containerRef, onCanvasDeselect, onViewportChange]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Prevent canvas scrolling from moving the page while preserving native scrolling inside overlays and dialogs.
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    const surfaceStyle = {
        background: theme.canvas.background,
        "--td-canvas-accent": themeName === "dark" ? "116 145 255" : "69 91 168",
        "--td-canvas-neutral": themeName === "dark" ? "226 232 255" : "255 255 255",
        "--td-canvas-vignette": themeName === "dark" ? "9 9 12" : "224 220 212",
        "--td-canvas-pan-x": `${(viewport.x * 0.025) % 120}px`,
        "--td-canvas-pan-y": `${(viewport.y * 0.025) % 120}px`,
        "--td-canvas-depth": `${Math.min(1.15, Math.max(0.72, viewport.k))}`,
    } as React.CSSProperties;

    return (
        <div
            ref={containerRef}
            className="td-canvas-surface relative h-full w-full cursor-grab select-none overflow-hidden"
            data-canvas-theme={themeName}
            style={surfaceStyle}
            onPointerDown={handlePointerDown}
            onPointerMove={handleAmbientPointerMove}
            onPointerLeave={resetAmbientPointer}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasAtmosphere />
            <CanvasGrid viewport={viewport} mode={backgroundMode} />
            <div
                className="absolute z-[2] origin-top-left"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function CanvasAtmosphere() {
    return (
        <div className="td-canvas-atmosphere" aria-hidden="true">
            <div className="td-canvas-pointer-glow" />
            <div className="td-canvas-vignette" />
        </div>
    );
}

function CanvasGrid({ viewport, mode }: { viewport: ViewportTransform; mode: CanvasBackgroundMode }) {
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    if (mode === "blank") return null;

    let worldGridSize = 16;
    while (worldGridSize * viewport.k < 8) worldGridSize *= 2;
    const gridSize = worldGridSize * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const depthGridSize = gridSize * 4;
    const depthX = (viewport.x * 0.78) % depthGridSize;
    const depthY = (viewport.y * 0.78) % depthGridSize;
    const density = viewport.k < 0.46 ? "far" : viewport.k > 1.55 ? "near" : "standard";
    const dotSize = viewport.k < 0.4 ? 0.75 : viewport.k > 1.55 ? 1.1 : 1;
    const depthDotSize = viewport.k > 1.55 ? 1.15 : 1.35;
    const focusColor = themeName === "dark" ? "rgba(255,255,255,.34)" : "rgba(68,64,60,.38)";
    const primaryImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;
    const depthImage =
        mode === "dots"
            ? `radial-gradient(circle, ${theme.canvas.dot} ${depthDotSize}px, transparent ${depthDotSize + 0.25}px)`
            : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;
    const focusImage = mode === "dots" ? `radial-gradient(circle, ${focusColor} ${dotSize}px, transparent ${dotSize + 0.25}px)` : `linear-gradient(${focusColor} 1px, transparent 1px), linear-gradient(90deg, ${focusColor} 1px, transparent 1px)`;

    return (
        <div className="td-canvas-grid pointer-events-none absolute inset-0" data-grid-density={density} data-grid-mode={mode} aria-hidden="true">
            <div
                className="td-canvas-grid-plane td-canvas-grid-depth"
                style={{
                    backgroundImage: depthImage,
                    backgroundSize: `${depthGridSize}px ${depthGridSize}px`,
                    backgroundPosition: `${depthX}px ${depthY}px`,
                }}
            />
            <div
                className="td-canvas-grid-plane td-canvas-grid-primary"
                style={{
                    backgroundImage: primaryImage,
                    backgroundSize: `${gridSize}px ${gridSize}px`,
                    backgroundPosition: `${x}px ${y}px`,
                }}
            />
            <div
                className="td-canvas-grid-plane td-canvas-grid-focus"
                style={{
                    backgroundImage: focusImage,
                    backgroundSize: `${gridSize}px ${gridSize}px`,
                    backgroundPosition: `${x}px ${y}px`,
                }}
            />
        </div>
    );
}
