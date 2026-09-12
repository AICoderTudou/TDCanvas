import type { CanvasAlignmentGuides } from "@/lib/canvas/canvas-alignment-guides";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

type CanvasAlignmentGuidesProps = {
    guides: CanvasAlignmentGuides;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
};

export function CanvasAlignmentGuideOverlay({ guides, viewport, viewportSize }: CanvasAlignmentGuidesProps) {
    const themeName = useThemeStore((state) => state.theme);
    const scale = Math.max(viewport.k, 0.05);
    const viewLeft = -viewport.x / scale;
    const viewTop = -viewport.y / scale;
    const viewWidth = viewportSize.width / scale;
    const viewHeight = viewportSize.height / scale;
    const stroke = Math.max(0.5, 1 / scale);
    const color = themeName === "dark" ? "rgba(179, 196, 255, .72)" : "rgba(55, 85, 188, .62)";
    const glow = themeName === "dark" ? "rgba(91, 125, 255, .28)" : "rgba(55, 85, 188, .18)";

    return (
        <div className="pointer-events-none absolute inset-0 z-[4]" data-canvas-alignment-guides aria-hidden="true">
            {guides.vertical.map((x) => (
                <span key={`vertical-${x}`} className="absolute" data-canvas-alignment-guide="vertical" style={{ left: x - stroke / 2, top: viewTop, width: stroke, height: viewHeight, background: color, boxShadow: `0 0 ${4 / scale}px ${glow}` }} />
            ))}
            {guides.horizontal.map((y) => (
                <span key={`horizontal-${y}`} className="absolute" data-canvas-alignment-guide="horizontal" style={{ left: viewLeft, top: y - stroke / 2, width: viewWidth, height: stroke, background: color, boxShadow: `0 0 ${4 / scale}px ${glow}` }} />
            ))}
        </div>
    );
}
