import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

export function canvasNodeToolbarAnchor(node: CanvasNodeData, viewport: ViewportTransform) {
    const isNativeWorkbench = [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType);
    const titleClearance = (isNativeWorkbench ? 48 : 36) * viewport.k + 8;
    return {
        left: viewport.x + (node.position.x + node.width / 2) * viewport.k,
        top: viewport.y + node.position.y * viewport.k - titleClearance,
    };
}
