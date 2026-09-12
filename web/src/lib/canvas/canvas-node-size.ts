export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    return { width: w * scale, height: h * scale };
}

export const CANVAS_NODE_RESIZE_LIMITS = {
    minWidth: 220,
    minHeight: 160,
    maxWidth: 1600,
    maxHeight: 1200,
} as const;

type NodeResizeSize = { width: number; height: number };

export function clampCanvasNodeResize(width: number, height: number, keepRatio: boolean, ratio: number, limits: typeof CANVAS_NODE_RESIZE_LIMITS = CANVAS_NODE_RESIZE_LIMITS): NodeResizeSize {
    const finiteWidth = Number.isFinite(width) ? width : limits.minWidth;
    const finiteHeight = Number.isFinite(height) ? height : limits.minHeight;
    if (!keepRatio || !Number.isFinite(ratio) || ratio <= 0) {
        return {
            width: clamp(finiteWidth, limits.minWidth, limits.maxWidth),
            height: clamp(finiteHeight, limits.minHeight, limits.maxHeight),
        };
    }

    const maxRatioWidth = Math.min(limits.maxWidth, limits.maxHeight * ratio);
    const minRatioWidth = Math.min(maxRatioWidth, Math.max(limits.minWidth, limits.minHeight * ratio));
    const nextWidth = clamp(finiteWidth, minRatioWidth, maxRatioWidth);
    return { width: nextWidth, height: nextWidth / ratio };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

type NodeGeometry = {
    position: { x: number; y: number };
    width: number;
    height: number;
    metadata?: { freeResize?: boolean };
};

export function fitMediaNodeGeometry(node: NodeGeometry, naturalWidth: number | undefined, naturalHeight: number | undefined, maxWidth: number, maxHeight: number) {
    const current = { position: node.position, width: node.width, height: node.height };
    if (node.metadata?.freeResize || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth! <= 0 || naturalHeight! <= 0) return current;
    const size = fitNodeSize(naturalWidth!, naturalHeight!, maxWidth, maxHeight);
    return {
        ...size,
        position: {
            x: node.position.x + node.width / 2 - size.width / 2,
            y: node.position.y + node.height / 2 - size.height / 2,
        },
    };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}
