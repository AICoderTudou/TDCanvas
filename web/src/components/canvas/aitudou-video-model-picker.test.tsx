import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { canvasThemes } from "@/lib/canvas-theme";

import { aitudouNativeVideoModelCategories } from "./aitudou-native-generation";
import { AitudouVideoModelMenu, AitudouVideoModelPicker } from "./aitudou-video-model-picker";

describe("Aitudou video model picker", () => {
    const categories = aitudouNativeVideoModelCategories("video.generate");
    const prices = new Map([["seedance-2.0-standard", "约 ¥0.40"]]);

    it("keeps the closed trigger compact and identifies it as a two-level model picker", () => {
        const html = renderToStaticMarkup(<AitudouVideoModelPicker categories={categories} value="seedance-2.0-standard" priceLabels={prices} automaticMode="文生视频" theme={canvasThemes.dark} onChange={vi.fn()} />);

        expect(html).toContain("data-aitudou-video-model-picker");
        expect(html).toContain("Seedance 2.0 Standard");
        expect(html).toMatch(/data-video-model-selected-label="true"[^>]*whitespace-normal/);
        expect(html).not.toMatch(/data-video-model-selected-label="true"[^>]*truncate/);
        expect(html).toContain('aria-haspopup="dialog"');
        expect(html).not.toContain("data-aitudou-video-model-menu");
    });

    it("renders provider categories separately from the active provider's versions", () => {
        const html = renderToStaticMarkup(
            <AitudouVideoModelMenu
                id="video-model-menu"
                categories={categories}
                activeCategoryId="seedance"
                selectedValue="seedance-2.0-standard"
                priceLabels={prices}
                automaticMode="文生视频"
                theme={canvasThemes.dark}
                onActiveCategoryChange={vi.fn()}
                onSelect={vi.fn()}
            />,
        );

        expect(html).toContain("data-aitudou-video-model-menu");
        for (const category of ["seedance", "minimax", "flux", "aitudou-video"]) expect(html).toContain(`data-video-model-category="${category}"`);
        for (const category of ["happyhorse", "wan", "kling", "vidu"]) expect(html).not.toContain(`data-video-model-category="${category}"`);
        expect(html).toContain('data-video-model-option="seedance-2.0-standard"');
        expect(html).toContain("文生视频");
        expect(html).toContain("图生视频");
        expect(html).toContain("约 ¥0.40");
        expect(html).not.toMatch(/data-video-model-option="(?:happyhorse|wan|kling|vidu)-/);
    });

    it("shows the complete secondary model name instead of ellipsizing it", () => {
        const longModelName = "Seedance 2.5 Global Multi Reference Professional Edition";
        const html = renderToStaticMarkup(
            <AitudouVideoModelMenu
                id="video-model-menu"
                categories={[
                    {
                        id: "seedance",
                        label: "Seedance",
                        options: [
                            {
                                value: "seedance-long-name",
                                label: longModelName,
                                group: "Seedance",
                                capabilities: ["文生视频", "图生视频"],
                            },
                        ],
                    },
                ]}
                activeCategoryId="seedance"
                selectedValue="seedance-long-name"
                priceLabels={new Map([["seedance-long-name", "约 ¥0.40–0.80"]])}
                automaticMode="文生视频"
                theme={canvasThemes.dark}
                onActiveCategoryChange={vi.fn()}
                onSelect={vi.fn()}
            />,
        );

        expect(html).toContain(longModelName);
        expect(html).toMatch(/data-video-model-option-label="seedance-long-name"[^>]*whitespace-normal/);
        expect(html).toMatch(/data-video-model-option-label="seedance-long-name"[^>]*break-words/);
        expect(html).not.toMatch(/data-video-model-option-label="seedance-long-name"[^>]*truncate/);
    });

    it("falls back to an available category when a removed provider was saved as active", () => {
        const html = renderToStaticMarkup(
            <AitudouVideoModelMenu
                id="video-model-menu"
                categories={categories}
                activeCategoryId="kling"
                selectedValue="seedance-2.0-standard"
                priceLabels={prices}
                automaticMode="文生视频"
                theme={canvasThemes.dark}
                onActiveCategoryChange={vi.fn()}
                onSelect={vi.fn()}
            />,
        );

        expect(html).toContain('data-video-model-option="seedance-2.0-standard"');
        expect(html).not.toContain('data-video-model-category="kling"');
        expect(html).not.toMatch(/data-video-model-option="kling-/);
    });
});
