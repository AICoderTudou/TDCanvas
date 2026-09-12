export type CanvasDragFrame = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

export type CanvasAlignmentGuides = {
    vertical: number[];
    horizontal: number[];
};

type ResolveCanvasNodeDragOptions = {
    moving: CanvasDragFrame[];
    stationary: CanvasDragFrame[];
    rawDx: number;
    rawDy: number;
    scale: number;
    snapToGrid: boolean;
    gridStep?: number;
    thresholdPx?: number;
};

const EMPTY_GUIDES: CanvasAlignmentGuides = { vertical: [], horizontal: [] };

export function resolveCanvasNodeDrag({ moving, stationary, rawDx, rawDy, scale, snapToGrid, gridStep = 16, thresholdPx = 7 }: ResolveCanvasNodeDragOptions) {
    const bounds = frameBounds(moving);
    if (!bounds) return { dx: rawDx, dy: rawDy, guides: EMPTY_GUIDES };

    let dx = snapToGrid ? Math.round((bounds.left + rawDx) / gridStep) * gridStep - bounds.left : rawDx;
    let dy = snapToGrid ? Math.round((bounds.top + rawDy) / gridStep) * gridStep - bounds.top : rawDy;
    const threshold = thresholdPx / Math.max(scale, 0.05);
    const xMatch = closestAlignment(
        axisAnchors(bounds.left + rawDx, bounds.right + rawDx),
        stationary.flatMap((frame) => axisAnchors(frame.x, frame.x + frame.width)),
        threshold,
    );
    const yMatch = closestAlignment(
        axisAnchors(bounds.top + rawDy, bounds.bottom + rawDy),
        stationary.flatMap((frame) => axisAnchors(frame.y, frame.y + frame.height)),
        threshold,
    );

    if (xMatch) dx = rawDx + xMatch.offset;
    if (yMatch) dy = rawDy + yMatch.offset;

    return {
        dx,
        dy,
        guides: {
            vertical: xMatch ? [xMatch.position] : [],
            horizontal: yMatch ? [yMatch.position] : [],
        },
    };
}

function frameBounds(frames: CanvasDragFrame[]) {
    if (!frames.length) return null;
    return frames.reduce(
        (bounds, frame) => ({
            left: Math.min(bounds.left, frame.x),
            top: Math.min(bounds.top, frame.y),
            right: Math.max(bounds.right, frame.x + frame.width),
            bottom: Math.max(bounds.bottom, frame.y + frame.height),
        }),
        { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY },
    );
}

function axisAnchors(start: number, end: number) {
    return [start, start + (end - start) / 2, end];
}

function closestAlignment(movingAnchors: number[], stationaryAnchors: number[], threshold: number): { offset: number; position: number; distance: number } | null {
    let match: { offset: number; position: number; distance: number } | null = null;
    for (const moving of movingAnchors) {
        for (const stationary of stationaryAnchors) {
            const offset = stationary - moving;
            const distance = Math.abs(offset);
            if (distance > threshold || (match && distance >= match.distance)) continue;
            match = { offset, position: stationary, distance };
        }
    }
    return match;
}
