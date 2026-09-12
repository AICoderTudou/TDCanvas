import i18n from "@/i18n";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { getNodeSpec as getRegistryNodeSpec } from "@/lib/canvas/node-registry";
import { aitudouDefaultPayload } from "@/services/api/aitudou-contract";

type CanvasNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: {
        width: 620,
        height: 350,
        get title() {
            return i18n.t("canvas.nodeTypes.image");
        },
    },
    [CanvasNodeType.Text]: {
        width: 520,
        height: 300,
        get title() {
            return i18n.t("canvas.nodeTypes.text");
        },
    },
    [CanvasNodeType.Config]: {
        width: 340,
        height: 240,
        get title() {
            return i18n.t("canvas.nodeTypes.config");
        },
    },
    [CanvasNodeType.Video]: {
        width: 660,
        height: 371,
        get title() {
            return i18n.t("canvas.nodeTypes.video");
        },
    },
    [CanvasNodeType.Audio]: {
        width: 540,
        height: 160,
        get title() {
            return i18n.t("canvas.nodeTypes.audio");
        },
    },
    [CanvasNodeType.Aitudou]: {
        width: 380,
        height: 220,
        get title() {
            return i18n.t("canvas.nodeTypes.aitudou");
        },
    },
    [CanvasNodeType.Group]: {
        width: 760,
        height: 480,
        get title() {
            return i18n.t("canvas.nodeTypes.group");
        },
    },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        width: 620,
        height: 350,
        get title() {
            return NODE_DEFAULT_SIZE[CanvasNodeType.Image].title;
        },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        width: 520,
        height: 300,
        get title() {
            return NODE_DEFAULT_SIZE[CanvasNodeType.Text].title;
        },
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Config]: {
        width: 340,
        height: 240,
        get title() {
            return NODE_DEFAULT_SIZE[CanvasNodeType.Config].title;
        },
        metadata: { content: "", status: "idle", generationMode: "image" },
    },
    [CanvasNodeType.Video]: {
        width: 660,
        height: 371,
        get title() {
            return NODE_DEFAULT_SIZE[CanvasNodeType.Video].title;
        },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Audio]: {
        width: 540,
        height: 160,
        get title() {
            return NODE_DEFAULT_SIZE[CanvasNodeType.Audio].title;
        },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Aitudou]: {
        width: 380,
        height: 220,
        get title() {
            return NODE_DEFAULT_SIZE[CanvasNodeType.Aitudou].title;
        },
        metadata: {
            status: "idle",
            aitudouOperation: "video.generate",
            aitudouPayload: aitudouDefaultPayload("video.generate"),
            providerTask: { provider: "aitudou", action: "video.generate", family: "video", phase: "idle", status: "idle", progress: 0 },
        },
    },
    [CanvasNodeType.Group]: {
        width: 760,
        height: 480,
        get title() {
            return NODE_DEFAULT_SIZE[CanvasNodeType.Group].title;
        },
        metadata: { status: "idle" },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

// Return built-in specs directly and resolve plugin types from the registry.
export function getNodeSpec(type: string) {
    if ((Object.values(CanvasNodeType) as string[]).includes(type)) return NODE_SPECS[type as CanvasNodeType];
    const spec = getRegistryNodeSpec(type);
    return { width: spec.width, height: spec.height, title: spec.title, metadata: spec.metadata };
}
