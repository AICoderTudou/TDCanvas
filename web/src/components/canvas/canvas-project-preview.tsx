import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasProjectPreview({ project }: { project: Pick<CanvasProject, "nodes" | "connections"> }) {
    const layout = buildPreviewLayout(project.nodes);
    const nodeById = new Map(layout.map((item) => [item.node.id, item]));

    if (!layout.length) {
        return (
            <div data-canvas-project-preview="empty" className="absolute inset-0 grid place-items-center">
                <div className="relative grid size-12 place-items-center rounded-2xl border border-black/[0.08] bg-white/45 dark:border-white/[0.08] dark:bg-white/[0.035]">
                    <span className="h-px w-4 bg-stone-400/70 dark:bg-zinc-600" />
                    <span className="absolute h-4 w-px bg-stone-400/70 dark:bg-zinc-600" />
                </div>
            </div>
        );
    }

    return (
        <svg data-canvas-project-preview="nodes" className="absolute inset-0 size-full text-stone-400/55 dark:text-zinc-600/75" viewBox="0 0 100 62" preserveAspectRatio="none" aria-hidden="true">
            <defs>
                <linearGradient id="td-home-node-accent" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#8178ff" />
                    <stop offset="1" stopColor="#5d55d8" />
                </linearGradient>
            </defs>
            <g fill="none" stroke="currentColor" strokeWidth="0.55">
                {project.connections.slice(0, 24).map((connection) => {
                    const from = nodeById.get(connection.fromNodeId);
                    const to = nodeById.get(connection.toNodeId);
                    if (!from || !to) return null;
                    const startX = from.x + from.width;
                    const startY = from.y + from.height / 2;
                    const endX = to.x;
                    const endY = to.y + to.height / 2;
                    const bend = Math.max(4, (endX - startX) * 0.48);
                    return <path key={connection.id} d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`} />;
                })}
            </g>
            <g>
                {layout.map(({ node, x, y, width, height }) => {
                    const media = node.type === "image" || node.type === "video";
                    return (
                        <g key={node.id} data-preview-node-type={node.type}>
                            <rect x={x} y={y} width={width} height={height} rx="1.8" fill={media ? "url(#td-home-node-accent)" : "currentColor"} opacity={media ? 0.86 : node.type === "text" ? 0.42 : 0.25} />
                            <rect x={x + 1.2} y={y + 1.2} width={Math.max(0, width - 2.4)} height="0.7" rx="0.35" fill="white" opacity={media ? 0.36 : 0.22} />
                        </g>
                    );
                })}
            </g>
        </svg>
    );
}

type PreviewLayoutNode = {
    node: CanvasNodeData;
    x: number;
    y: number;
    width: number;
    height: number;
};

function buildPreviewLayout(nodes: readonly CanvasNodeData[]): PreviewLayoutNode[] {
    const visibleNodes = nodes.filter((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).slice(0, 18);
    if (!visibleNodes.length) return [];

    const minX = Math.min(...visibleNodes.map((node) => node.position.x));
    const minY = Math.min(...visibleNodes.map((node) => node.position.y));
    const maxX = Math.max(...visibleNodes.map((node) => node.position.x + Math.max(80, node.width)));
    const maxY = Math.max(...visibleNodes.map((node) => node.position.y + Math.max(56, node.height)));
    const worldWidth = Math.max(1, maxX - minX);
    const worldHeight = Math.max(1, maxY - minY);
    const scale = Math.min(88 / worldWidth, 50 / worldHeight);
    const offsetX = (100 - worldWidth * scale) / 2;
    const offsetY = (62 - worldHeight * scale) / 2;

    return visibleNodes.map((node) => ({
        node,
        x: offsetX + (node.position.x - minX) * scale,
        y: offsetY + (node.position.y - minY) * scale,
        width: Math.max(5.5, Math.min(34, Math.max(80, node.width) * scale)),
        height: Math.max(4.5, Math.min(24, Math.max(56, node.height) * scale)),
    }));
}
