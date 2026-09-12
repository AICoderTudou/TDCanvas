import { describe, expect, it } from "vitest";

import { AITUDOU_PRICING_URL, formatAitudouPriceQuote, parseAitudouPricingCatalog, quoteAitudouPrice } from "./aitudou-pricing";

const live = process.env.AITUDOU_LIVE_PRICING === "1" ? describe : describe.skip;

live("Aitudou live pricing contract", () => {
    it("quotes representative image, video, audio and Midjourney parameters from the current official feed", async () => {
        const response = await fetch(AITUDOU_PRICING_URL, { headers: { Accept: "application/json" } });
        expect(response.ok).toBe(true);
        const catalog = parseAitudouPricingCatalog(await response.json());

        expect(catalog.pricingVersion).not.toBe("");
        expect(Object.keys(catalog.observedPrices).length).toBeGreaterThan(50);
        expect(Object.values(catalog.priceEstimates).filter((profile) => profile.status === "ready").length).toBeGreaterThan(20);

        const image = quoteAitudouPrice(catalog, "image.generate", { model: "qwen-image-3.0-global-pro-i2i", n: 4, metadata: { resolution: "1k" } }, { imageReferences: 1 });
        expect(image).toEqual(expect.objectContaining({ source: "estimate", status: "exact" }));
        expect(image.amount).toBeGreaterThan(0);

        const video = quoteAitudouPrice(catalog, "video.generate", { model: "aitudou-video-gk-v15", seconds: "8", metadata: { resolution: "720p" } });
        expect(video).toEqual(expect.objectContaining({ source: "estimate", status: "range" }));
        expect(video.max).toBeGreaterThanOrEqual(video.min || 0);

        const seedance = quoteAitudouPrice(catalog, "video.generate", { model: "seedance-2.5-standard-t2v", seconds: "6", metadata: { resolution: "720p", generate_audio: true } });
        expect(seedance).toEqual(expect.objectContaining({ status: "range", currency: "CNY" }));
        expect(formatAitudouPriceQuote(seedance)).not.toContain("Token");

        const audio = quoteAitudouPrice(catalog, "audio.generate", { model: "doubao-seed-audio-1.0" }, { audioReferences: 2 });
        expect(audio).toEqual(expect.objectContaining({ source: "estimate", status: "range" }));

        const midjourney = quoteAitudouPrice(catalog, "midjourney.imagine", { speed: "fast", hd: true });
        expect(midjourney).toEqual(expect.objectContaining({ source: "estimate", status: "range" }));
    });
});
