import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";

vi.mock("@/stores/use-theme-store", () => ({
    useThemeStore: (selector: (state: { theme: "dark" }) => unknown) => selector({ theme: "dark" }),
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { ConnectionPath } from "./canvas-connections";

const from = { id: "from", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 320, height: 180, metadata: {} } as CanvasNodeData;
const to = { id: "to", type: CanvasNodeType.Video, position: { x: 520, y: 40 }, width: 320, height: 180, metadata: {} } as CanvasNodeData;
const connection = { id: "edge", fromNodeId: from.id, toNodeId: to.id } as CanvasConnection;
const pluginId = "connection-path-test";

afterEach(() => unregisterPluginNodes(pluginId));

describe("canvas workflow connection motion", () => {
    it("renders a directional flow overlay while the connected workflow is running", () => {
        const html = renderToStaticMarkup(
            <svg>
                <ConnectionPath connection={connection} from={from} to={to} active={false} running onSelect={() => undefined} />
            </svg>,
        );

        expect(html).toContain('data-connection-running="true"');
        expect(html).toContain("td-canvas-connection-running-flow");
        expect(html).toContain('pathLength="100"');
        expect(html).toContain("td-canvas-connection-running-glow");
    });

    it("keeps idle connections visually still", () => {
        const html = renderToStaticMarkup(
            <svg>
                <ConnectionPath connection={connection} from={from} to={to} active={false} onSelect={() => undefined} />
            </svg>,
        );

        expect(html).not.toContain("data-connection-running");
    });

    it("draws named connections from their exact port anchors", () => {
        const source = { ...from, type: `${pluginId}:source` };
        const target = { ...to, type: `${pluginId}:target` };
        registerNodeDefinitions(
            [
                { type: source.type, title: "源", icon: null, defaultSize: { width: 320, height: 180 }, ports: [{ id: "image", label: "图像", direction: "output", dataType: "image" }, { id: "mask", label: "遮罩", direction: "output", dataType: "image" }] },
                { type: target.type, title: "目标", icon: null, defaultSize: { width: 320, height: 180 }, ports: [{ id: "prompt", label: "提示词", direction: "input", dataType: "text" }, { id: "image", label: "图像", direction: "input", dataType: "image" }] },
            ],
            pluginId,
        );
        const html = renderToStaticMarkup(
            <svg>
                <ConnectionPath connection={{ id: "named", fromNodeId: source.id, fromPortId: "image", toNodeId: target.id, toPortId: "image" }} from={source} to={target} active={false} onSelect={() => undefined} />
            </svg>,
        );

        expect(html).toContain("M 320 60 C");
        expect(html).toContain(", 520 160");
    });
});
