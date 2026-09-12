import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
            clear: () => values.clear(),
        },
    });
});

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { canvasThemes } from "@/lib/canvas-theme";
import type { AitudouPriceQuote } from "@/services/api/aitudou-pricing";
import { AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, changeAitudouNativeModelChoice, createAitudouNativePayload, writeAitudouNativeParameter } from "./aitudou-native-generation";
import { AitudouDurationParameterControl, AitudouNativeGenerationPanel, AitudouRatioParameterControl, scaleCanvasBatchQuoteFromPayload } from "./aitudou-native-generation-panel";

const exactQuote = (amount: number): AitudouPriceQuote => ({
    status: "exact",
    source: "observed",
    sku: "candidate",
    unit: "task",
    amount,
    currency: "CNY",
    approximate: true,
    explanation: "candidate quote",
});

describe("Aitudou native image panel", () => {
    it("keeps the RHTV-style basic action row without a more-operations entry", () => {
        const node: CanvasNodeData = {
            id: "image-node",
            type: CanvasNodeType.Image,
            title: "图片",
            position: { x: 0, y: 0 },
            width: 620,
            height: 350,
            metadata: {
                aitudouOperation: "midjourney.imagine",
                aitudouPayload: JSON.stringify({ prompt: "cinematic lake", version: "8.1" }),
            },
        };

        const html = renderToStaticMarkup(<AitudouNativeGenerationPanel node={node} kind="image" onChange={() => undefined} />);

        expect(html).toContain("生成数量 1");
        expect(html).toContain("开始生成");
        expect(html).not.toContain("更多操作");
        expect(html).not.toContain("高级参数");
    });

    it("uses the verified RHTV auto-tile and four-column ratio layout", () => {
        const options = ["adaptive", "1:1", "2:3", "3:2", "4:5", "5:4", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "2:1", "1:2", "3:1", "1:3"].map((value) => ({
            label: value === "adaptive" ? "自适应" : value,
            value,
        }));

        const html = renderToStaticMarkup(<AitudouRatioParameterControl options={options} value="16:9" theme={canvasThemes.dark} onChange={() => undefined} />);

        expect(html).toContain('data-aitudou-ratio-layout="rhtv"');
        expect(html).toContain('data-aitudou-ratio-adaptive="true"');
        expect(html.indexOf("data-aitudou-ratio-adaptive")).toBeLessThan(html.indexOf("data-aitudou-ratio-grid"));
        expect(html.match(/data-aitudou-ratio-value=/g)).toHaveLength(16);
        expect(html).toContain('aria-pressed="true" data-aitudou-ratio-value="16:9"');
    });

    it("keeps a user-editable canvas batch count for single-result image APIs", () => {
        const node: CanvasNodeData = {
            id: "seedream-node",
            type: CanvasNodeType.Image,
            title: "图片",
            position: { x: 0, y: 0 },
            width: 620,
            height: 350,
            metadata: {
                aitudouOperation: "image.generate",
                aitudouPayload: JSON.stringify({ model: "seedream-v5-pro-t2i", prompt: "cinematic lake" }),
            },
        };

        const html = renderToStaticMarkup(<AitudouNativeGenerationPanel node={node} kind="image" onChange={() => undefined} />);

        expect(html).toContain("生成数量 1");
        expect(html).toContain(">1x<");
    });

    it("scales every candidate quote with the batch count produced by that candidate model", () => {
        const seedreamPayload = writeAitudouNativeParameter(createAitudouNativePayload("image.generate", { model: "seedream-v5-pro-t2i", prompt: "cinematic lake" }), AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, 4);
        const lowPriceCandidate = changeAitudouNativeModelChoice("image", "image.generate", seedreamPayload, "aitudou-image-g-v2-lowprice");

        expect(lowPriceCandidate.payload.n).toBe(4);
        expect(scaleCanvasBatchQuoteFromPayload(exactQuote(0.2), lowPriceCandidate.payload).amount).toBe(0.2);

        const lowPricePayload = createAitudouNativePayload("image.generate", { model: "aitudou-image-g-v2-lowprice", prompt: "cinematic lake", n: 4 });
        const seedreamCandidate = changeAitudouNativeModelChoice("image", "image.generate", lowPricePayload, "seedream-v5-pro");

        expect(seedreamCandidate.payload.n).toBeUndefined();
        expect(scaleCanvasBatchQuoteFromPayload(exactQuote(0.3), seedreamCandidate.payload).amount).toBe(1.2);
    });

    it("renders an explicit seconds slider instead of automatic duration", () => {
        const html = renderToStaticMarkup(<AitudouDurationParameterControl definition={{ path: "seconds", label: "生成时长", control: "slider", min: 4, max: 15, step: 1 }} value="5" theme={canvasThemes.dark} onChange={() => undefined} />);

        expect(html).toContain("data-aitudou-duration-slider");
        expect(html).toContain('data-duration-min="4"');
        expect(html).toContain('data-duration-max="15"');
        expect(html).toContain("生成时长秒数");
        expect(html).toContain(">秒<");
        expect(html).not.toContain("自动");
    });

    it("explains that MiniMax H3 OW uses only the first ordered image", () => {
        const node: CanvasNodeData = {
            id: "minimax-video-node",
            type: CanvasNodeType.Video,
            title: "视频",
            position: { x: 0, y: 0 },
            width: 620,
            height: 350,
            metadata: {
                aitudouOperation: "video.generate",
                aitudouPayload: JSON.stringify({ model: "minimax-h3-ow-i2v", prompt: "cinematic movement", seconds: "5" }),
            },
        };

        const html = renderToStaticMarkup(
            <AitudouNativeGenerationPanel
                node={node}
                kind="video"
                referenceCounts={{ image: 2, video: 0, audio: 0, text: 0, task: 0 }}
                mentionReferences={[
                    { id: "edge-first", connectionId: "edge-first", source: "connection", nodeId: "first-image", kind: "image", label: "图片1", title: "首帧", previewUrl: "blob:first", active: true },
                    { id: "edge-second", connectionId: "edge-second", source: "connection", nodeId: "second-image", kind: "image", label: "图片2", title: "备选图片", previewUrl: "blob:second", active: true },
                ]}
                onChange={() => undefined}
            />,
        );

        expect(html).toContain("已连接 2 张图片，当前模型按排序只读取前 1 张");
        expect(html).toContain("模式 <strong");
        expect(html).toContain("图生视频");
        expect(html).toContain("图片 1 张（首帧）");
        expect(html).toMatch(/data-reference-node-id="first-image"[^>]*data-reference-used="true"/);
        expect(html).toMatch(/data-reference-node-id="second-image"[^>]*data-reference-used="false"/);
    });
});
