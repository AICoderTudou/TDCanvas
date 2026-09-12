import { describe, expect, it } from "vitest";

import { AITUDOU_OPERATIONS } from "@/services/api/aitudou-contract";
import { AITUDOU_MODEL_PROFILES, getAitudouModelProfile } from "@/services/api/aitudou-models";
import { AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH } from "./aitudou-aspect-dimensions";
import {
    AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH,
    AITUDOU_NATIVE_OPERATION_IDS_BY_KIND,
    AITUDOU_NATIVE_OUTPUT_COUNT_PATH,
    AITUDOU_NATIVE_SIZE_RATIO_PATH,
    AITUDOU_NATIVE_SPECIAL_MODEL_ADAPTERS,
    AITUDOU_NATIVE_UNSUPPORTED_MODEL_IDS,
    EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS,
    aitudouNativeKindForOperation,
    aitudouNativeModelCapability,
    aitudouNativeModelChoiceGroups,
    aitudouNativeModelGroups,
    aitudouNativeParameterDefinitions,
    aitudouNativeReferencedInputCounts,
    aitudouNativeVideoModelCategories,
    changeAitudouNativeModelChoice,
    changeAitudouNativeModel,
    createAitudouNativePayload,
    prepareAitudouNativeRun,
    readAitudouNativePrompt,
    validateAitudouNativePayload,
    writeAitudouNativeParameter,
    writeAitudouNativePrompt,
} from "./aitudou-native-generation";

describe("native Aitudou canvas classification", () => {
    it("maps every documented non-utility operation once to its native output node", () => {
        expect(AITUDOU_OPERATIONS).toHaveLength(55);
        expect(AITUDOU_NATIVE_OPERATION_IDS_BY_KIND.image).toHaveLength(15);
        expect(AITUDOU_NATIVE_OPERATION_IDS_BY_KIND.video).toHaveLength(4);
        expect(AITUDOU_NATIVE_OPERATION_IDS_BY_KIND.audio).toHaveLength(25);
        expect(AITUDOU_NATIVE_OPERATION_IDS_BY_KIND.text).toHaveLength(9);

        const nativeIds = Object.values(AITUDOU_NATIVE_OPERATION_IDS_BY_KIND).flat();
        const nonUtilityIds = AITUDOU_OPERATIONS.filter((operation) => !operation.id.startsWith("utility.")).map((operation) => operation.id);
        expect(nativeIds).toHaveLength(53);
        expect(new Set(nativeIds).size).toBe(53);
        expect(new Set(nativeIds)).toEqual(new Set(nonUtilityIds));
        expect(nativeIds).not.toContain("utility.upload");
        expect(nativeIds).not.toContain("utility.wallet");
    });

    it("keeps output-changing actions on the node that receives their result", () => {
        expect(aitudouNativeKindForOperation("midjourney.describe")).toBe("text");
        expect(aitudouNativeKindForOperation("midjourney.video")).toBe("video");
        expect(aitudouNativeKindForOperation("suno.generate-mp4")).toBe("video");
        expect(aitudouNativeKindForOperation("suno.lyrics")).toBe("text");
        expect(aitudouNativeKindForOperation("suno.generate")).toBe("audio");
    });

    it("builds the RHTV-style provider to version hierarchy without exposing transport variants", () => {
        const categories = aitudouNativeVideoModelCategories("video.generate");
        expect(categories.map((category) => category.label)).toEqual(["Seedance", "MiniMax", "Flux", "Aitudou Video"]);

        const flatChoices = categories.flatMap((category) => category.options);
        const legacyChoices = aitudouNativeModelGroups("video.generate").flatMap((group) => group.options);
        expect(flatChoices.map((choice) => choice.value).sort()).toEqual(legacyChoices.map((choice) => choice.value).sort());
        expect(new Set(flatChoices.map((choice) => choice.value)).size).toBe(flatChoices.length);
        expect(flatChoices.some((choice) => ["happyhorse-", "wan-", "kling-", "vidu-"].some((prefix) => choice.value.startsWith(prefix)))).toBe(false);

        const seedance = categories.find((category) => category.id === "seedance")!;
        expect(seedance.options.find((choice) => choice.value === "seedance-2.0-standard")?.capabilities).toEqual(["文生视频", "图生视频", "全能参考"]);
        expect(seedance.options.some((choice) => /-(t2v|i2v|multi)$/.test(choice.value))).toBe(false);

        const minimax = categories.find((category) => category.id === "minimax")!;
        expect(minimax.options.map((choice) => choice.value)).toEqual(expect.arrayContaining(["hailuo-2.3-standard", "hailuo-h3", "minimax-h3-ow"]));
        expect(categories.find((category) => category.id === "aitudou-video")?.options.map((choice) => choice.value)).toEqual(expect.arrayContaining(["aitudou-video-gk-v15", "aitudou-video-v31-fast", "aitudou-video-g-omni-flash"]));
    });

    it.each(["happyhorse-1.1-t2v", "wan-2.7-spicy-i2v", "kling-v3.0-std", "vidu-q3-pro-t2v"])("migrates the removed video model %s to the first available model", (modelId) => {
        const payload = createAitudouNativePayload("video.generate", { model: modelId, prompt: "旧项目提示词", seconds: "5" });
        expect(payload.model).toBe("seedance-2.0-standard-t2v");
        expect(payload.prompt).toBe("旧项目提示词");
    });
});

describe("native Aitudou payload adapter", () => {
    it("exposes documented Midjourney versions as image models and maps reference images to Imagine", () => {
        const choices = aitudouNativeModelChoiceGroups("image", "image.generate").flatMap((group) => group.options);
        expect(choices.map((choice) => choice.value)).toEqual(expect.arrayContaining(["midjourney:v8.2", "midjourney:v8.1", "midjourney:v7", "midjourney:v6.1", "midjourney:v5.2", "midjourney:v5.1", "midjourney:niji7", "midjourney:niji6"]));

        const counts = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 2 };
        const selected = changeAitudouNativeModelChoice("image", "image.generate", writeAitudouNativePrompt("image.generate", createAitudouNativePayload("image.generate"), "电影感城市夜景"), "midjourney:v8.1", counts);
        expect(selected.operationId).toBe("midjourney.imagine");
        expect(selected.payload).toEqual(expect.objectContaining({ prompt: "电影感城市夜景", version: "8.1", image_urls: ["@Image 1", "@Image 2"] }));
        expect(selected.payload).not.toHaveProperty("model");
        expect(validateAitudouNativePayload("image", selected.operationId, selected.payload, counts)).toBeNull();

        const niji = changeAitudouNativeModelChoice("image", "image.generate", createAitudouNativePayload("image.generate"), "midjourney:niji7", EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS);
        expect(niji.payload).toEqual(expect.objectContaining({ version: "7", niji: true }));
    });

    it("exposes only the requested Midjourney basics and maps 1x to an omitted repeat", () => {
        const paths = aitudouNativeParameterDefinitions("midjourney.imagine", createAitudouNativePayload("midjourney.imagine")).map((definition) => definition.path);
        expect(paths).toEqual([AITUDOU_NATIVE_SIZE_RATIO_PATH, "speed", AITUDOU_NATIVE_OUTPUT_COUNT_PATH, "hd"]);

        const v81Paths = aitudouNativeParameterDefinitions("midjourney.imagine", { ...createAitudouNativePayload("midjourney.imagine"), version: "8.1" }).map((definition) => definition.path);
        expect(v81Paths).toEqual([AITUDOU_NATIVE_SIZE_RATIO_PATH, "speed", AITUDOU_NATIVE_OUTPUT_COUNT_PATH, "hd"]);

        const v61Paths = aitudouNativeParameterDefinitions("midjourney.imagine", { ...createAitudouNativePayload("midjourney.imagine"), version: "6.1" }).map((definition) => definition.path);
        expect(v61Paths).toEqual([AITUDOU_NATIVE_SIZE_RATIO_PATH, "speed", AITUDOU_NATIVE_OUTPUT_COUNT_PATH]);

        let quantity = writeAitudouNativeParameter(createAitudouNativePayload("midjourney.imagine"), AITUDOU_NATIVE_OUTPUT_COUNT_PATH, 1);
        expect(quantity).not.toHaveProperty("repeat");
        quantity = writeAitudouNativeParameter(quantity, AITUDOU_NATIVE_OUTPUT_COUNT_PATH, 40);
        expect(quantity.repeat).toBe(40);
    });

    it("shows one vendor model choice and switches image transport variants from connected references", () => {
        const qwenOptions = aitudouNativeModelGroups("image.generate")
            .flatMap((group) => group.options)
            .filter((option) => option.value === "qwen-image-3.0-pro");
        expect(qwenOptions).toHaveLength(1);

        const textOnly = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "qwen-image-3.0-pro", EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS);
        expect(textOnly.model).toBe("qwen-image-3.0-pro-t2i");
        expect(textOnly).not.toHaveProperty("images");

        const withImageCounts = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 1 };
        const withImage = createAitudouNativePayload("image.generate", textOnly, withImageCounts);
        expect(withImage.model).toBe("qwen-image-3.0-pro-i2i");
        expect(withImage.images).toEqual(["@Image 1"]);

        const disconnected = createAitudouNativePayload("image.generate", withImage, EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS);
        expect(disconnected.model).toBe("qwen-image-3.0-pro-t2i");
        expect(disconnected).not.toHaveProperty("images");
    });

    it("selects the matching video transport variant without exposing capability filters", () => {
        const basePayload = createAitudouNativePayload("video.generate");
        const textOnly = changeAitudouNativeModel("video.generate", basePayload, "seedance-2.0-standard", EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS);
        expect(textOnly.model).toBe("seedance-2.0-standard-t2v");

        const imageCounts = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 1 };
        const imageReference = createAitudouNativePayload("video.generate", textOnly, imageCounts);
        expect(imageReference.model).toBe("seedance-2.0-standard-i2v");
        expect(imageReference.images).toEqual(["@Image 1"]);

        const mixedCounts = { ...imageCounts, video: 1, audio: 1 };
        const mixedReference = createAitudouNativePayload("video.generate", imageReference, mixedCounts);
        expect(mixedReference.model).toBe("seedance-2.0-standard-multi");
        expect(mixedReference.metadata).toEqual(
            expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ type: "image_url" }), expect.objectContaining({ type: "video_url" }), expect.objectContaining({ type: "audio_url" })]) }),
        );
    });

    it("uses explicit RHTV-style video durations and migrates legacy automatic values", () => {
        const seedance = createAitudouNativePayload("video.generate");
        expect(seedance).toEqual(expect.objectContaining({ model: "seedance-2.0-standard-t2v", seconds: "5" }));

        const seedanceDuration = aitudouNativeParameterDefinitions("video.generate", seedance).find((definition) => definition.path === "seconds");
        expect(seedanceDuration).toEqual(expect.objectContaining({ control: "slider", min: 4, max: 15, step: 1 }));
        expect(seedanceDuration?.options).toBeUndefined();
        expect(seedanceDuration?.optional).toBeUndefined();

        const migrated = createAitudouNativePayload("video.generate", { ...seedance, seconds: "-1", metadata: { duration: -1 } });
        expect(migrated.seconds).toBe("5");
        expect(migrated.metadata).not.toHaveProperty("duration");

        let seedance25 = changeAitudouNativeModel("video.generate", seedance, "seedance-2.5-standard-t2v");
        seedance25 = writeAitudouNativeParameter(seedance25, "seconds", "25");
        expect(seedance25.seconds).toBe("25");
        expect(changeAitudouNativeModel("video.generate", seedance25, "seedance-2.0-standard-t2v").seconds).toBe("5");

        const validAcrossModels = writeAitudouNativeParameter(seedance25, "seconds", "10");
        expect(changeAitudouNativeModel("video.generate", validAcrossModels, "seedance-2.0-standard-t2v").seconds).toBe("10");
    });

    it("applies model-specific fixed/default durations and removes duration for Omni", () => {
        const seedance = createAitudouNativePayload("video.generate");
        const minimax = changeAitudouNativeModel("video.generate", seedance, "minimax-h3-ow-t2v");
        expect(minimax.seconds).toBe("5");
        expect(
            aitudouNativeParameterDefinitions("video.generate", minimax)
                .find((definition) => definition.path === "seconds")
                ?.options?.map((option) => option.value),
        ).toEqual(["5", "10", "15"]);

        const twoImages = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 2 };
        const minimaxImageToVideo = changeAitudouNativeModel("video.generate", minimax, "minimax-h3-ow-i2v", twoImages);
        expect(minimaxImageToVideo).toEqual(expect.objectContaining({ model: "minimax-h3-ow-i2v", images: ["@Image 1"] }));
        expect(validateAitudouNativePayload("video", "video.generate", minimaxImageToVideo, twoImages)).toBeNull();
        expect(aitudouNativeReferencedInputCounts(minimaxImageToVideo)).toEqual({ image: 1, video: 0, audio: 0, text: 0, task: 0 });
        expect(aitudouNativeModelCapability(getAitudouModelProfile("minimax-h3-ow-i2v"))).toEqual({
            modeLabel: "图生视频",
            inputLabel: "图片 1 张（首帧）",
            parameterLabel: "5/10/15 秒 · 480p/720p · 比例 8 档",
        });

        const fixed = changeAitudouNativeModel("video.generate", { ...seedance, seconds: "6" }, "aitudou-video-v31-fast");
        expect(fixed.seconds).toBe("8");

        const omni = changeAitudouNativeModel("video.generate", { ...fixed, duration: 8, metadata: { duration: 8 } }, "aitudou-video-g-omni-flash");
        expect(omni).not.toHaveProperty("seconds");
        expect(omni).not.toHaveProperty("duration");
        expect(omni.metadata).not.toHaveProperty("duration");
        expect(aitudouNativeParameterDefinitions("video.generate", omni).some((definition) => definition.path === "seconds")).toBe(false);
    });

    it("keeps every documented duration default inside its model contract", () => {
        for (const profile of AITUDOU_MODEL_PROFILES.filter((candidate) => candidate.constraints?.seconds)) {
            const duration = profile.constraints!.seconds!;
            expect(Number.isInteger(duration.defaultValue), profile.id).toBe(true);
            if (duration.values?.length) expect(duration.values, profile.id).toContain(duration.defaultValue);
            if (duration.min !== undefined) expect(duration.defaultValue, profile.id).toBeGreaterThanOrEqual(duration.min);
            if (duration.max !== undefined) expect(duration.defaultValue, profile.id).toBeLessThanOrEqual(duration.max);
        }
    });

    it("starts native prompt workbenches blank and adopts a connected text node only when one exists", () => {
        const blank = createAitudouNativePayload("image.generate");
        expect(readAitudouNativePrompt("image.generate", blank)).toBe("");
        expect(validateAitudouNativePayload("image", "image.generate", blank, EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS)).toContain("prompt");

        const blankChat = createAitudouNativePayload("text.chat");
        expect(readAitudouNativePrompt("text.chat", blankChat)).toBe("");
        expect(validateAitudouNativePayload("text", "text.chat", blankChat, EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS)).toContain("用户消息内容");

        const withText = createAitudouNativePayload("image.generate", blank, { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, text: 1 });
        expect(readAitudouNativePrompt("image.generate", withText)).toBe("@Text 1");
        expect(validateAitudouNativePayload("image", "image.generate", withText, { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, text: 1 })).toBeNull();
    });

    it("writes connected image references for image-to-image without inventing fields", () => {
        const counts = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 2 };
        let payload = createAitudouNativePayload("image.generate", undefined, counts);
        payload = changeAitudouNativeModel("image.generate", payload, "qwen-image-3.0-i2i", counts);
        writeAitudouNativePrompt("image.generate", payload, "把两张参考图融合为产品海报");

        expect(payload).toEqual(expect.objectContaining({ model: "qwen-image-3.0-i2i", images: ["@Image 1", "@Image 2"] }));
        expect(validateAitudouNativePayload("image", "image.generate", payload, counts)).toBeNull();
    });

    it("derives Seedream dimensions from one ratio + resolution choice and removes the competing resolution field", () => {
        let payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "seedream-v5-pro-t2i");
        payload = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH, "2k");
        payload = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, "16:9");

        expect(payload.metadata).toEqual(expect.objectContaining({ width: 2560, height: 1440 }));
        expect(payload.metadata).not.toHaveProperty("resolution");
        expect(payload.metadata).not.toHaveProperty("ratio");
        expect(JSON.stringify(payload)).not.toContain("$tdcanvas");
        writeAitudouNativePrompt("image.generate", payload, "宽银幕电影场景");
        expect(validateAitudouNativePayload("image", "image.generate", payload)).toBeNull();
    });

    it("keeps adaptive dimensionless and clears stale Seedream dimensions when resolution wins", () => {
        let payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "seedream-v5-pro-t2i");
        payload = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH, "1k");
        payload = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, "16:9");
        expect(payload.metadata).toEqual(expect.objectContaining({ width: 1280, height: 720 }));

        payload = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, "adaptive");
        expect(payload.metadata).not.toHaveProperty("width");
        expect(payload.metadata).not.toHaveProperty("height");
        expect(payload.metadata).toEqual(expect.objectContaining({ resolution: "1k" }));

        payload = writeAitudouNativeParameter(payload, "metadata.width", 1024);
        payload = writeAitudouNativeParameter(payload, "metadata.height", 576);
        payload = writeAitudouNativeParameter(payload, "metadata.resolution", "1k");
        payload = createAitudouNativePayload("image.generate", payload);
        expect(payload.metadata).not.toHaveProperty("width");
        expect(payload.metadata).not.toHaveProperty("height");
    });

    it("clears derived Seedream-only dimensions when changing to another image model", () => {
        let payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "seedream-v5-pro-t2i");
        payload = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, "3:4");
        expect(payload.metadata).toEqual(expect.objectContaining({ width: 1728, height: 2304 }));

        payload = changeAitudouNativeModel("image.generate", payload, "qwen-image-3.0-t2i");
        expect(payload.metadata).not.toHaveProperty("width");
        expect(payload.metadata).not.toHaveProperty("height");
        expect(payload.metadata).toEqual(expect.objectContaining({ ratio: "3:4", resolution: "2k" }));
    });

    it("migrates semantic geometry to Seedream and keeps its virtual fields out of the payload", () => {
        let payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "qwen-image-3.0-t2i");
        payload = writeAitudouNativeParameter(payload, "metadata.ratio", "16:9");
        payload = writeAitudouNativeParameter(payload, "metadata.resolution", "1k");
        payload = changeAitudouNativeModel("image.generate", payload, "seedream-v5-pro-t2i");

        expect(payload.metadata).toEqual(expect.objectContaining({ width: 1280, height: 720 }));
        expect(payload.metadata).not.toHaveProperty("ratio");
        expect(payload.metadata).not.toHaveProperty("resolution");
        expect(JSON.stringify(payload)).not.toContain("$tdcanvas");
    });

    it("removes arbitrary image ratios even when the upstream API accepts custom values", () => {
        let qwen = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "qwen-image-3.0-t2i");
        const ratioDefinition = aitudouNativeParameterDefinitions("image.generate", qwen).find((definition) => definition.path === "metadata.ratio");
        expect(ratioDefinition?.options?.map((option) => option.value)).toEqual(["adaptive", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"]);
        qwen = writeAitudouNativeParameter(qwen, "metadata.ratio", "adaptive");
        expect(qwen.metadata).not.toHaveProperty("ratio");
        qwen = writeAitudouNativeParameter(qwen, "metadata.ratio", "7:5");
        qwen = createAitudouNativePayload("image.generate", qwen);
        expect(qwen.metadata).not.toHaveProperty("ratio");

        let strict = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "aitudou-image-g2-t2i");
        strict = writeAitudouNativeParameter(strict, "metadata.ratio", "7:5");
        strict = createAitudouNativePayload("image.generate", strict);
        expect(strict.metadata).not.toHaveProperty("ratio");
    });

    it("keeps Aitudou Image G-2 on its documented 1K-only contract", () => {
        let payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "aitudou-image-g2-t2i");
        payload = writeAitudouNativeParameter(payload, "metadata.resolution", "4k");
        payload.quality = "high";
        (payload.metadata as Record<string, unknown>).quality = "high";
        payload = createAitudouNativePayload("image.generate", payload);

        const definitions = aitudouNativeParameterDefinitions("image.generate", payload);
        const ratio = definitions.find((definition) => definition.path === "metadata.ratio");
        const resolution = definitions.find((definition) => definition.path === "metadata.resolution");
        expect(ratio?.options?.map((option) => option.value)).toEqual(["adaptive", "16:9", "9:16", "1:1"]);
        expect(resolution?.options?.map((option) => option.value)).toEqual(["1k"]);
        expect(definitions.map((definition) => definition.path)).not.toContain("metadata.quality");
        expect(payload.metadata).toEqual(expect.objectContaining({ resolution: "1k" }));
        expect(payload).not.toHaveProperty("quality");
        expect(payload.metadata).not.toHaveProperty("quality");
    });

    it("removes legacy custom dimensions because image geometry is preset-only", () => {
        let payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "seedream-v5-pro-t2i");
        payload = writeAitudouNativeParameter(payload, "metadata.resolution", undefined);
        payload = writeAitudouNativeParameter(payload, "metadata.width", 1537);
        payload = writeAitudouNativeParameter(payload, "metadata.height", 1043);
        payload = createAitudouNativePayload("image.generate", payload);
        expect(payload.metadata).not.toHaveProperty("width");
        expect(payload.metadata).not.toHaveProperty("height");
        expect(payload.metadata).toEqual(expect.objectContaining({ resolution: "2k" }));

        payload = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RESOLUTION_PATH, "1k");
        payload = writeAitudouNativeParameter(payload, AITUDOU_SEEDREAM_VIRTUAL_RATIO_PATH, "4:3");
        expect(payload.metadata).toEqual(expect.objectContaining({ width: 1152, height: 864 }));
    });

    it("uses documented metadata.content entries for multi-reference video", () => {
        const counts = { image: 2, video: 1, audio: 1, text: 0, task: 0 };
        let payload = createAitudouNativePayload("video.generate", undefined, counts);
        payload = changeAitudouNativeModel("video.generate", payload, "seedance-2.0-standard-multi", counts);
        writeAitudouNativePrompt("video.generate", payload, "保持角色一致并生成环绕镜头");

        expect(payload.metadata).toEqual(
            expect.objectContaining({
                content: [
                    { type: "image_url", image_url: { url: "@Image 1" } },
                    { type: "image_url", image_url: { url: "@Image 2" } },
                    { type: "video_url", video_url: { url: "@Video 1" } },
                    { type: "audio_url", audio_url: { url: "@Audio 1" } },
                ],
            }),
        );
        expect(validateAitudouNativePayload("video", "video.generate", payload, counts)).toBeNull();
    });

    it("adapts video upscaling and blocks a missing connected video", () => {
        const noReferences = EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS;
        const invalid = createAitudouNativePayload("video.upscale", undefined, noReferences);
        expect(validateAitudouNativePayload("video", "video.upscale", invalid, noReferences)).toContain("metadata.content");

        const counts = { ...noReferences, video: 1 };
        const valid = createAitudouNativePayload("video.upscale", undefined, counts);
        expect(valid).toEqual(
            expect.objectContaining({
                model: "aitudou-upscaler",
                metadata: expect.objectContaining({ content: [{ type: "video_url", video_url: { url: "@Video 1" } }] }),
            }),
        );
        expect(validateAitudouNativePayload("video", "video.upscale", valid, counts)).toBeNull();
    });

    it("stores Kimi prompt in the documented messages array", () => {
        const payload = createAitudouNativePayload("text.chat");
        writeAitudouNativePrompt("text.chat", payload, "总结当前画布内容");
        expect(readAitudouNativePrompt("text.chat", payload)).toBe("总结当前画布内容");
        expect(payload.messages).toEqual([{ role: "user", content: "总结当前画布内容" }]);
        expect(validateAitudouNativePayload("text", "text.chat", payload, EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS)).toBeNull();
    });

    it("reports exact missing canvas placeholder inputs before a paid request", () => {
        const payload = createAitudouNativePayload("midjourney.blend");
        expect(validateAitudouNativePayload("image", "midjourney.blend", payload, EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS)).toBe("还需要连接第 1 个图片节点。");

        const twoImages = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 2 };
        const valid = createAitudouNativePayload("midjourney.blend", undefined, twoImages);
        expect(valid.image_urls).toEqual(["@Image 1", "@Image 2"]);
        expect(validateAitudouNativePayload("image", "midjourney.blend", valid, twoImages)).toBeNull();
    });

    it("keeps an exhaustive adapter decision for every documented special and lip-sync model", () => {
        const documented = AITUDOU_MODEL_PROFILES.filter((profile) => profile.inputKind === "special" || profile.inputKind === "lip-sync")
            .map((profile) => profile.id)
            .sort();
        expect(Object.keys(AITUDOU_NATIVE_SPECIAL_MODEL_ADAPTERS).sort()).toEqual(documented);
        expect(documented).toHaveLength(19);
        expect(AITUDOU_NATIVE_UNSUPPORTED_MODEL_IDS.slice().sort()).toEqual(["kling-elements-advanced", "kling-lip-sync-identify-face", "kling-lip-sync-tts", "kling-lip-sync-video"]);
    });

    it.each(["hailuo-h3-multi", "hailuo-h3-global-multi"])("maps mixed native references to the documented top-level Hailuo H3 fields for %s", (modelId) => {
        const counts = { image: 2, video: 2, audio: 2, text: 1, task: 0 };
        let payload = createAitudouNativePayload("video.generate", undefined, counts);
        payload = changeAitudouNativeModel("video.generate", payload, modelId, counts);

        expect(payload).toEqual(
            expect.objectContaining({
                model: modelId,
                images: ["@Image 1", "@Image 2"],
                video_url: ["@Video 1", "@Video 2"],
                audio_url: ["@Audio 1", "@Audio 2"],
            }),
        );
        expect(payload.metadata).not.toHaveProperty("content");
        expect(validateAitudouNativePayload("video", "video.generate", payload, counts)).toBeNull();
    });

    it("uses connected video or task for the two mutually exclusive Omni continuation modes", () => {
        const videoCounts = { image: 2, video: 1, audio: 0, text: 1, task: 1 };
        let videoPayload = createAitudouNativePayload("video.generate", undefined, videoCounts);
        videoPayload = changeAitudouNativeModel("video.generate", videoPayload, "aitudou-video-g-omni-flash", videoCounts);
        expect(videoPayload.images).toEqual(["@Image 1", "@Image 2"]);
        expect(videoPayload.metadata).toEqual(expect.objectContaining({ video_url: "@Video 1" }));
        expect(videoPayload.metadata).not.toHaveProperty("extend_from_task_id");
        expect(videoPayload).not.toHaveProperty("seconds");
        expect(validateAitudouNativePayload("video", "video.generate", videoPayload, videoCounts)).toBeNull();

        const taskCounts = { image: 0, video: 0, audio: 0, text: 0, task: 1 };
        let taskPayload = createAitudouNativePayload("video.generate", undefined, taskCounts);
        taskPayload = changeAitudouNativeModel("video.generate", taskPayload, "aitudou-video-g-omni-flash", taskCounts);
        delete taskPayload.prompt;
        expect(taskPayload.metadata).toEqual(expect.objectContaining({ extend_from_task_id: "@Task 1" }));
        expect(taskPayload.metadata).not.toHaveProperty("video_url");
        expect(validateAitudouNativePayload("video", "video.generate", taskPayload, taskCounts)).toBeNull();
    });

    it.each(["aitudou-video-gk-v15", "aitudou-video-v31-fast"])("injects optional image references for documented Aitudou video model %s", (modelId) => {
        const counts = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 4, text: 1 };
        let payload = createAitudouNativePayload("video.generate", undefined, counts);
        payload = changeAitudouNativeModel("video.generate", payload, modelId, counts);
        const expectedCount = modelId === "aitudou-video-v31-fast" ? 3 : 4;
        expect(payload.images).toEqual(Array.from({ length: expectedCount }, (_, index) => `@Image ${index + 1}`));
        if (modelId === "aitudou-video-v31-fast") expect(payload.seconds).toBe("8");
        expect(validateAitudouNativePayload("video", "video.generate", payload, counts)).toBeNull();
    });

    it("removes reference mode from Aitudou V31 quality and pins its documented duration", () => {
        const counts = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 3, text: 1 };
        let payload = createAitudouNativePayload("video.generate", undefined, counts);
        payload = changeAitudouNativeModel("video.generate", payload, "aitudou-video-v31-fast", counts);
        payload.type = "reference";
        payload = changeAitudouNativeModel("video.generate", payload, "aitudou-video-v31-quality", counts);
        expect(payload).not.toHaveProperty("images");
        expect(payload).not.toHaveProperty("type");
        expect(payload.seconds).toBe("8");
        expect(validateAitudouNativePayload("video", "video.generate", payload, counts)).toBeNull();
    });

    it.each(["aitudou-image-g-v2-lowprice", "aitudou-image-nb-flash", "aitudou-image-nb-2", "aitudou-image-nb-2-lite", "aitudou-image-nb-pro"])("injects optional image inputs without exposing a free-form size field for %s", (modelId) => {
        const counts = { ...EMPTY_AITUDOU_NATIVE_REFERENCE_COUNTS, image: 20, text: 1 };
        let payload = createAitudouNativePayload("image.generate", undefined, counts);
        payload = changeAitudouNativeModel("image.generate", payload, modelId, counts);
        const profile = AITUDOU_MODEL_PROFILES.find((candidate) => candidate.id === modelId)!;
        expect(payload.images).toHaveLength(profile.constraints?.maxImages || 0);
        const definitions = aitudouNativeParameterDefinitions("image.generate", payload);
        expect(definitions).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "size", control: "text" })]));
        if (modelId === "aitudou-image-g-v2-lowprice") expect(definitions.map((definition) => definition.path)).toContain(AITUDOU_NATIVE_SIZE_RATIO_PATH);
        expect(validateAitudouNativePayload("image", "image.generate", payload, counts)).toBeNull();
    });

    it("keeps every image geometry control preset-only and adds the documented GK v2 model", () => {
        expect(AITUDOU_MODEL_PROFILES.map((profile) => profile.id)).toContain("aitudou-image-gk-v2");
        for (const profile of AITUDOU_MODEL_PROFILES.filter((candidate) => candidate.family === "image")) {
            const payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), profile.id);
            const definitions = aitudouNativeParameterDefinitions("image.generate", payload);
            expect(definitions.filter((definition) => /ratio|size|width|height/i.test(definition.path)).every((definition) => definition.control === "select")).toBe(true);
            expect(definitions.map((definition) => definition.path)).not.toEqual(expect.arrayContaining(["metadata.width", "metadata.height", "size"]));
        }
    });

    it("uses the RHTV low-price GPT ratio presets and narrows them for 4K", () => {
        let payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "aitudou-image-g-v2-lowprice");
        const initialDefinitions = aitudouNativeParameterDefinitions("image.generate", payload);
        let definition = initialDefinitions.find((item) => item.path === AITUDOU_NATIVE_SIZE_RATIO_PATH)!;
        expect(definition.control).toBe("select");
        expect(definition.options?.map((option) => option.value)).toEqual(expect.arrayContaining(["adaptive", "1:1", "4:5", "16:9", "21:9", "1:3"]));
        expect(initialDefinitions.find((item) => item.path === "metadata.resolution")?.options?.map((option) => option.value)).toEqual(["adaptive", "1k", "2k", "4k"]);

        payload = writeAitudouNativeParameter(payload, "metadata.resolution", "adaptive");
        expect(payload.metadata).not.toHaveProperty("resolution");

        payload = writeAitudouNativeParameter(payload, "metadata.resolution", "4k");
        payload = writeAitudouNativeParameter(payload, AITUDOU_NATIVE_SIZE_RATIO_PATH, "1:1");
        payload = createAitudouNativePayload("image.generate", payload);
        expect(payload).not.toHaveProperty("size");
        definition = aitudouNativeParameterDefinitions("image.generate", payload).find((item) => item.path === AITUDOU_NATIVE_SIZE_RATIO_PATH)!;
        expect(definition.options?.map((option) => option.value)).toEqual(["adaptive", "16:9", "9:16", "21:9", "9:21"]);

        payload = writeAitudouNativeParameter(payload, AITUDOU_NATIVE_SIZE_RATIO_PATH, "21:9");
        payload = createAitudouNativePayload("image.generate", payload);
        expect(payload).toEqual(expect.objectContaining({ size: "21:9", n: 1 }));
    });

    it("shows a quantity for every image model and keeps native n separate from canvas batching", () => {
        const definitionFor = (modelId: string) => {
            const payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), modelId);
            return aitudouNativeParameterDefinitions("image.generate", payload).find((definition) => ["n", AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH].includes(definition.path));
        };

        expect(definitionFor("seedream-v5-pro-t2i")).toEqual(expect.objectContaining({ path: AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, control: "number", min: 1, max: 4 }));
        expect(definitionFor("aitudou-image-g2-t2i")).toEqual(expect.objectContaining({ path: AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, control: "number", min: 1, max: 4 }));
        expect(definitionFor("qwen-image-3.0-pro-t2i")).toEqual(expect.objectContaining({ control: "number", min: 1, max: 6 }));
        expect(definitionFor("aitudou-image-g-v2-lowprice")).toEqual(expect.objectContaining({ control: "number", min: 1, max: 10 }));
        expect(definitionFor("aitudou-image-nb-2-lite")).toEqual(expect.objectContaining({ control: "number", min: 1, max: 4 }));
        expect(definitionFor("aitudou-image-nb-pro")).toEqual(expect.objectContaining({ path: AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, max: 4 }));
    });

    it("strips canvas batching before the API call and migrates the selected count to native n", () => {
        let payload = changeAitudouNativeModel("image.generate", createAitudouNativePayload("image.generate"), "seedream-v5-pro-t2i");
        payload = writeAitudouNativeParameter(payload, AITUDOU_NATIVE_CANVAS_BATCH_COUNT_PATH, 4);
        const plan = prepareAitudouNativeRun(payload);
        expect(plan.batchCount).toBe(4);
        expect(plan.payload).not.toHaveProperty("$tdcanvas");
        expect(payload).toEqual(expect.objectContaining({ $tdcanvas: { batchCount: 4 } }));

        payload = changeAitudouNativeModel("image.generate", payload, "qwen-image-3.0-pro-t2i");
        expect(payload).toEqual(expect.objectContaining({ n: 4 }));
        expect(payload).not.toHaveProperty("$tdcanvas");
        expect(prepareAitudouNativeRun(payload)).toEqual(expect.objectContaining({ batchCount: 1 }));
    });

    it("exposes only officially named scalar controls for Flux draft, Flux draft creation, Hailuo and Omni", () => {
        const parameterPaths = (modelId: string) => {
            let payload = createAitudouNativePayload("video.generate");
            payload = changeAitudouNativeModel("video.generate", payload, modelId);
            return aitudouNativeParameterDefinitions("video.generate", payload).map((definition) => definition.path);
        };

        expect(parameterPaths("flux-3-video-draft-enhance")).toContain("metadata.draft_cache");
        expect(parameterPaths("flux-3-video-t2v")).toEqual(expect.arrayContaining(["metadata.draft", "metadata.generate_audio", "metadata.safety_tolerance"]));
        expect(parameterPaths("hailuo-h3-multi")).toContain("metadata.ratio");
        expect(parameterPaths("aitudou-video-g-omni-flash")).toEqual(expect.arrayContaining(["metadata.extend_from_task_id", "metadata.ratio"]));

        let draftPayload = createAitudouNativePayload("video.generate");
        draftPayload = changeAitudouNativeModel("video.generate", draftPayload, "flux-3-video-draft-enhance");
        delete draftPayload.prompt;
        expect(validateAitudouNativePayload("video", "video.generate", draftPayload)).toContain("metadata.draft_cache");
        draftPayload = writeAitudouNativeParameter(draftPayload, "metadata.draft_cache", "documented-draft-cache");
        expect(validateAitudouNativePayload("video", "video.generate", draftPayload)).toBeNull();
    });

    it.each(["kling-elements-advanced", "kling-lip-sync-identify-face", "kling-lip-sync-tts", "kling-lip-sync-video"])("does not allow the removed Kling model %s to remain selected", (modelId) => {
        let payload = createAitudouNativePayload("video.generate");
        payload = changeAitudouNativeModel("video.generate", payload, modelId);
        expect(payload.model).toBe("seedance-2.0-standard-t2v");
    });
});
