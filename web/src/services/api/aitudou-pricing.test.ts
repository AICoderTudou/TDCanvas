import { describe, expect, it, vi } from "vitest";

import { AITUDOU_PRICING_PROXY_URL, formatAitudouPriceQuote, loadAitudouPricingCatalog, parseAitudouPricingCatalog, quoteAitudouPrice, resetAitudouPricingCacheForTest, resolveAitudouPricingSku } from "./aitudou-pricing";

const catalog = parseAitudouPricingCatalog({
    pricing_version: "test-version",
    data: [{ model_name: "free-looking", model_price: 0 }],
    observed_prices: {
        "qwen-image-3.0-pro-t2i": {
            entries: [
                { params: { "metadata.resolution": "1k" }, price_cny: 0.345, last_seen_at: 100 },
                { params: { "metadata.resolution": "2k" }, price_cny: 0.675, last_seen_at: 200 },
            ],
            price_min: 0.345,
            price_max: 0.675,
        },
        "midjourney-imagine": {
            entries: [
                { params: { speed: "relax" }, price_cny: 0.47292, last_seen_at: 200 },
                { params: { speed: "fast" }, price_cny: 0.57792, last_seen_at: 201 },
            ],
            price_min: 0.47292,
            price_max: 0.57792,
        },
    },
});

describe("Aitudou pricing catalog", () => {
    it("loads pricing through the same-origin proxy in browsers and shares one in-flight request", async () => {
        const originalWindow = globalThis.window;
        Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
        resetAitudouPricingCacheForTest();
        try {
            const fetchMock = vi.fn(async () => new Response(JSON.stringify({ pricing_version: "shared", observed_prices: {} }), { status: 200 }));
            vi.stubGlobal("fetch", fetchMock);
            const [first, second] = await Promise.all([loadAitudouPricingCatalog(), loadAitudouPricingCatalog()]);
            expect(first.pricingVersion).toBe("shared");
            expect(second).toBe(first);
            expect(fetchMock).toHaveBeenCalledOnce();
            expect(fetchMock).toHaveBeenCalledWith(AITUDOU_PRICING_PROXY_URL, expect.any(Object));
        } finally {
            vi.unstubAllGlobals();
            Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
            resetAitudouPricingCacheForTest();
        }
    });

    it("parses only positive observed CNY prices and never treats model_price=0 as free", () => {
        expect(catalog.pricingVersion).toBe("test-version");
        expect(catalog.observedPrices["qwen-image-3.0-pro-t2i"]?.entries).toHaveLength(2);
        expect(catalog.observedPrices["free-looking"]).toBeUndefined();
    });

    it("uses the most specific compatible observed parameters", () => {
        const quote = quoteAitudouPrice(catalog, "image.generate", { model: "qwen-image-3.0-pro-t2i", metadata: { resolution: "2k" } });
        expect(quote).toEqual(expect.objectContaining({ status: "exact", source: "observed", amount: 0.675, pricingVersion: "test-version" }));
        expect(formatAitudouPriceQuote(quote, "menu")).toBe("约 ¥0.675/次");
    });

    it("falls back to a model range when current parameters do not identify one observation", () => {
        const quote = quoteAitudouPrice(catalog, "image.generate", { model: "qwen-image-3.0-pro-t2i" });
        expect(quote).toEqual(expect.objectContaining({ status: "range", min: 0.345, max: 0.675 }));
    });

    it("maps Midjourney and Suno operations to the official pricing SKUs", () => {
        expect(resolveAitudouPricingSku("midjourney.imagine", { version: "8.1" })).toBe("midjourney-imagine");
        expect(resolveAitudouPricingSku("suno.generate", { model: "suno" })).toBe("suno-generation");
        expect(resolveAitudouPricingSku("suno.cover-song", { model: "suno" })).toBe("suno-cover-song");
        expect(quoteAitudouPrice(catalog, "midjourney.imagine", { speed: "fast" })).toEqual(expect.objectContaining({ status: "exact", amount: 0.57792 }));
        expect(quoteAitudouPrice(catalog, "midjourney.imagine", { speed: "fast", repeat: 3 })).toEqual(expect.objectContaining({ status: "exact", amount: 1.73376 }));
    });

    it("uses the 720p Midjourney video SKU and multiplies batch prices", () => {
        expect(resolveAitudouPricingSku("midjourney.video", { video_type: "vid_1.1_i2v_720" })).toBe("midjourney-video-720p");
        const videoCatalog = parseAitudouPricingCatalog({
            pricing_version: "video",
            observed_prices: { "midjourney-video": { entries: [{ params: {}, price_cny: 2.1, last_seen_at: 1 }], price_min: 2.1, price_max: 2.1 } },
        });
        expect(quoteAitudouPrice(videoCatalog, "midjourney.video", { batch_size: 4 })).toEqual(expect.objectContaining({ amount: 8.4 }));
    });

    it("does not multiply an observed total a second time when its parameters already include quantity", () => {
        const videoCatalog = parseAitudouPricingCatalog({
            pricing_version: "video-with-batch",
            observed_prices: {
                "midjourney-video": {
                    entries: [{ params: { batch_size: 4 }, price_cny: 8.4, last_seen_at: 1 }],
                    price_min: 8.4,
                    price_max: 8.4,
                },
            },
        });
        expect(quoteAitudouPrice(videoCatalog, "midjourney.video", { batch_size: 4 })).toEqual(expect.objectContaining({ amount: 8.4 }));
    });

    it("prefers the official trained estimate and matches duration buckets", () => {
        const liveCatalog = parseAitudouPricingCatalog({
            pricing_version: "trained",
            price_estimates: {
                "aitudou-video-gk-v15": {
                    status: "ready",
                    active_features: ["duration_seconds", "resolution"],
                    sample_count: 703,
                    entries: [
                        { params: { duration_seconds: "6..10", resolution: "720p" }, price_cny: 1.37664, low_cny: 1.37664, high_cny: 2.2944, sample_count: 83, confidence: "high", last_seen_at: 10 },
                        { params: { duration_seconds: "15..30", resolution: "720p" }, price_cny: 4.32, low_cny: 2.88, high_cny: 6.8832, sample_count: 23, confidence: "medium", last_seen_at: 11 },
                    ],
                    price_min: 1.37664,
                    price_max: 6.8832,
                },
            },
            observed_prices: {
                "aitudou-video-gk-v15": { entries: [{ params: {}, price_cny: 9, last_seen_at: 1 }], price_min: 9, price_max: 9 },
            },
        });
        const quote = quoteAitudouPrice(liveCatalog, "video.generate", { model: "aitudou-video-gk-v15", seconds: "8", metadata: { resolution: "720p" } });
        expect(quote).toEqual(expect.objectContaining({ source: "estimate", status: "range", min: 1.37664, max: 2.2944 }));
        expect(quote.explanation).toContain("83 次");
    });

    it("matches output_count totals exactly and never multiplies them twice", () => {
        const liveCatalog = parseAitudouPricingCatalog({
            pricing_version: "outputs",
            price_estimates: {
                "qwen-image-3.0-global-pro-i2i": {
                    status: "ready",
                    active_features: ["output_count", "input_image_count", "resolution"],
                    entries: [
                        { params: { output_count: "1", input_image_count: "1", resolution: "1k" }, price_cny: 0.415268, low_cny: 0.330085, high_cny: 0.415268, last_seen_at: 1 },
                        { params: { output_count: "4", input_image_count: "1", resolution: "1k" }, price_cny: 1.565239, low_cny: 1.565239, high_cny: 1.565239, last_seen_at: 2 },
                    ],
                    price_min: 0.330085,
                    price_max: 1.565239,
                },
            },
        });
        const quote = quoteAitudouPrice(liveCatalog, "image.generate", { model: "qwen-image-3.0-global-pro-i2i", n: 4, metadata: { resolution: "1k" } }, { imageReferences: 1 });
        expect(quote).toEqual(expect.objectContaining({ source: "estimate", status: "exact", amount: 1.565239 }));
    });

    it("scales documented per-image estimates, but uses an honest range when a model has no quantity formula", () => {
        const liveCatalog = parseAitudouPricingCatalog({
            pricing_version: "quantity-policy",
            price_estimates: {
                "qwen-image-3.0-t2i": {
                    status: "ready",
                    active_features: [],
                    entries: [{ params: {}, price_cny: 0.216, low_cny: 0.192, high_cny: 0.24, last_seen_at: 1 }],
                    price_min: 0.192,
                    price_max: 0.24,
                },
                "aitudou-image-gk-v2": {
                    status: "ready",
                    active_features: [],
                    entries: [{ params: {}, price_cny: 0.1575, low_cny: 0.1575, high_cny: 0.1575, last_seen_at: 1 }],
                    price_min: 0.1575,
                    price_max: 0.1575,
                },
            },
        });
        expect(quoteAitudouPrice(liveCatalog, "image.generate", { model: "qwen-image-3.0-t2i", n: 6 })).toEqual(expect.objectContaining({ min: 1.152, max: 1.44 }));
        const unknownFormula = quoteAitudouPrice(liveCatalog, "image.generate", { model: "aitudou-image-gk-v2", n: 4 });
        expect(unknownFormula).toEqual(expect.objectContaining({ status: "range", min: 0.1575, max: 0.63 }));
        expect(unknownFormula.explanation).toContain("未公开该模型多图数量公式");
    });

    it("matches boolean audio-reference features from the official estimate", () => {
        const liveCatalog = parseAitudouPricingCatalog({
            pricing_version: "audio",
            price_estimates: {
                "doubao-seed-audio-1.0": {
                    status: "ready",
                    active_features: ["has_audio_input", "input_audio_count"],
                    entries: [{ params: { has_audio_input: "true", input_audio_count: "2" }, price_cny: 0.083742, low_cny: 0.072387, high_cny: 0.113548, sample_count: 8, confidence: "medium", last_seen_at: 1 }],
                    price_min: 0.072387,
                    price_max: 0.113548,
                },
            },
        });
        expect(quoteAitudouPrice(liveCatalog, "audio.generate", { model: "doubao-seed-audio-1.0" }, { audioReferences: 2 })).toEqual(expect.objectContaining({ source: "estimate", min: 0.072387, max: 0.113548 }));
    });

    it("infers Seedream pricing resolution from its generated width and height", () => {
        const liveCatalog = parseAitudouPricingCatalog({
            pricing_version: "seedream",
            price_estimates: {
                "seedream-v5-pro-t2i": {
                    status: "ready",
                    active_features: ["resolution"],
                    entries: [
                        { params: { resolution: "1k" }, price_cny: 0.31, low_cny: 0.31, high_cny: 0.31, last_seen_at: 1 },
                        { params: { resolution: "2k" }, price_cny: 0.62, low_cny: 0.62, high_cny: 0.62, last_seen_at: 2 },
                    ],
                    price_min: 0.31,
                    price_max: 0.62,
                },
            },
        });
        expect(quoteAitudouPrice(liveCatalog, "image.generate", { model: "seedream-v5-pro-t2i", metadata: { width: 2560, height: 1440 } })).toEqual(expect.objectContaining({ status: "exact", amount: 0.62 }));
    });

    it("does not claim a speed-only Midjourney estimate is exact when HD has no published price rule", () => {
        const liveCatalog = parseAitudouPricingCatalog({
            pricing_version: "mj-hd",
            price_estimates: {
                "midjourney-imagine": {
                    status: "ready",
                    active_features: ["speed"],
                    entries: [
                        { params: { speed: "relax" }, price_cny: 0.47292, low_cny: 0.47292, high_cny: 0.47292, last_seen_at: 1 },
                        { params: { speed: "fast" }, price_cny: 0.57792, low_cny: 0.57792, high_cny: 0.57792, last_seen_at: 2 },
                        { params: { speed: "turbo" }, price_cny: 1.05, low_cny: 1.05, high_cny: 1.05, last_seen_at: 3 },
                    ],
                    price_min: 0.47292,
                    price_max: 1.05,
                },
            },
        });
        expect(quoteAitudouPrice(liveCatalog, "midjourney.imagine", { speed: "fast", hd: true })).toEqual(expect.objectContaining({ status: "range", min: 0.47292, max: 1.05 }));
    });
});

describe("documented pricing fallbacks", () => {
    it("does not expose Seedance's million-token rate as a user-facing price when live history is unavailable", () => {
        const quote = quoteAitudouPrice(null, "video.generate", { model: "seedance-2.0-standard-t2v", seconds: "5", metadata: { resolution: "1080p" } });
        expect(quote).toEqual(expect.objectContaining({ status: "dynamic", unit: "task", currency: "CNY" }));
        expect(quote.explanation).toContain("¥0.28/秒");
        expect(formatAitudouPriceQuote(quote)).toBe("按实际结算");
        expect(formatAitudouPriceQuote(quote)).not.toContain("Token");
    });

    it("uses exact-model settled history to turn Seedance into a current-duration CNY range", () => {
        const liveCatalog = parseAitudouPricingCatalog({
            pricing_version: "seedance-history",
            observed_prices: {
                "seedance-2.5-standard-t2v": {
                    entries: [
                        { params: { "metadata.resolution": "720p", "metadata.generate_audio": true, seconds: 4 }, price_cny: 6.96, last_seen_at: 1 },
                        { params: { "metadata.resolution": "720p", "metadata.generate_audio": true, seconds: 10 }, price_cny: 21.77, last_seen_at: 2 },
                        { params: { "metadata.resolution": "480p", "metadata.generate_audio": true, seconds: 5 }, price_cny: 4.83, last_seen_at: 3 },
                    ],
                    price_min: 4.83,
                    price_max: 21.77,
                },
            },
        });
        const quote = quoteAitudouPrice(liveCatalog, "video.generate", { model: "seedance-2.5-standard-t2v", seconds: "5", metadata: { resolution: "720p", generate_audio: true } });
        expect(quote).toEqual(expect.objectContaining({ status: "range", source: "observed", min: 8.7, max: 10.885 }));
        expect(formatAitudouPriceQuote(quote)).toBe("约 ¥8.70–10.89");
        expect(formatAitudouPriceQuote(quote)).not.toContain("Token");
    });

    it("calculates documented per-second guidance and fixed matrices when parameters are known", () => {
        expect(quoteAitudouPrice(null, "video.generate", { model: "happyhorse-1.1-t2v", seconds: "5", metadata: { resolution: "720p" } })).toEqual(expect.objectContaining({ status: "exact", amount: 3.45 }));
        expect(quoteAitudouPrice(null, "video.generate", { model: "minimax-h3-ow-t2v", seconds: "10", metadata: { resolution: "720p" } })).toEqual(expect.objectContaining({ status: "exact", amount: 1 }));
    });

    it("labels settlement-only actions without a fake zero", () => {
        const quote = quoteAitudouPrice(null, "suno.cover-song", { model: "suno" });
        expect(quote).toEqual(expect.objectContaining({ status: "dynamic", source: "docs" }));
        expect(formatAitudouPriceQuote(quote)).toBe("按实际结算");
        expect(formatAitudouPriceQuote(quoteAitudouPrice(null, "audio.transcribe", {}))).toBe("按实际结算");
    });

    it("keeps upscaler guidance as a per-second rate when the input video duration is unknown", () => {
        expect(quoteAitudouPrice(null, "video.upscale", { model: "aitudou-upscaler", seconds: "20", metadata: { resolution: "1080p" } })).toEqual(expect.objectContaining({ status: "rate", amount: 0.21, unit: "second" }));
    });
});
