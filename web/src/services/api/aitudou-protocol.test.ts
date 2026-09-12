import { describe, expect, it } from "vitest";

import { AITUDOU_OPERATIONS, getAitudouOperation } from "./aitudou-contract";
import { AITUDOU_DOCUMENTED_MEDIA_MODEL_COUNT, AITUDOU_MODEL_COUNT, AITUDOU_MODEL_PROFILES } from "./aitudou-models";
import { assertAitudouEnvelope, extractAitudouCreateTaskIds, extractAitudouOutputs, extractAitudouText, normalizeAitudouTaskResponse, parseAitudouSse, pollPathForAitudouTask } from "./aitudou-protocol";

describe("Aitudou official contract snapshot", () => {
    it("contains every documented operation without camelCase upstream action paths", () => {
        expect(AITUDOU_OPERATIONS).toHaveLength(55);
        expect(AITUDOU_OPERATIONS.filter((item) => item.group === "general")).toHaveLength(8);
        expect(AITUDOU_OPERATIONS.filter((item) => item.group === "midjourney")).toHaveLength(16);
        expect(AITUDOU_OPERATIONS.filter((item) => item.group === "suno")).toHaveLength(31);
        expect(new Set(AITUDOU_OPERATIONS.map((item) => item.id)).size).toBe(55);
        expect(
            AITUDOU_OPERATIONS.map((item) => item.path).filter((path) => /(?:uploadTask|coverSong|upsampleTags|stemsAll|generateMp4|fadeIn|fadeOut|removeSection|replaceMusic|adjustSpeed|alignedLyrics|addVocals|addInstrumental|addStem)/.test(path)),
        ).toEqual([]);
    });

    it("contains the 123 media model ids plus Kimi, Whisper and Suno", () => {
        expect(AITUDOU_DOCUMENTED_MEDIA_MODEL_COUNT).toBe(123);
        expect(AITUDOU_MODEL_COUNT).toBe(126);
        expect(AITUDOU_MODEL_PROFILES).toHaveLength(126);
        expect(new Set(AITUDOU_MODEL_PROFILES.map((item) => item.id)).size).toBe(126);
        expect(AITUDOU_MODEL_PROFILES.find((item) => item.id === "kimi-k3")?.family).toBe("text");
        expect(AITUDOU_MODEL_PROFILES.find((item) => item.id === "whisper-1")?.family).toBe("transcription");
        expect(AITUDOU_MODEL_PROFILES.find((item) => item.id === "suno")?.family).toBe("music");
    });

    it("keeps cross-model defaults constraint-safe while retaining documented prompts", () => {
        expect(getAitudouOperation("video.generate").defaultPayload).toEqual({ model: "", prompt: "@Text 1" });
        expect(getAitudouOperation("suno.generate").requiredFields).toEqual(["version"]);
        expect(getAitudouOperation("suno.generate").defaultPayload).toEqual(expect.objectContaining({ model: "suno", version: "v5.5", prompt: "@Text 1" }));
    });
});

describe("Aitudou family decoders", () => {
    it("extracts task ids from all documented create envelopes", () => {
        expect(extractAitudouCreateTaskIds("video", { id: "vid_1", status: "queued" })).toEqual(["vid_1"]);
        expect(extractAitudouCreateTaskIds("image", { id: "img_1", task_id: "img_1", status: "queued" })).toEqual(["img_1"]);
        expect(extractAitudouCreateTaskIds("audio", { code: "success", data: [{ task_id: "aud_1", status: "submitted" }] })).toEqual(["aud_1"]);
        expect(extractAitudouCreateTaskIds("midjourney", { code: 200, data: [{ status: "submitted", task_id: "mj_1" }] })).toEqual(["mj_1"]);
        expect(extractAitudouCreateTaskIds("music", { code: 200, data: { id: "music_1", status: "submitted" } })).toEqual(["music_1"]);
    });

    it("normalizes video queued, completed and failed states", () => {
        expect(normalizeAitudouTaskResponse("video", "vid_1", { id: "vid_1", status: "queued" }).phase).toBe("queued");
        expect(normalizeAitudouTaskResponse("video", "vid_1", { id: "vid_1", status: "in_progress", progress: 0.4 }).progress).toBe(40);
        expect(normalizeAitudouTaskResponse("video", "vid_1", { id: "vid_1", status: "completed", progress: 100, metadata: { url: "https://example/video.mp4" } }).phase).toBe("succeeded");
        const failed = normalizeAitudouTaskResponse("video", "vid_1", { id: "vid_1", status: "failed", error: { code: "generation_failed", message: "failed" } });
        expect(failed.phase).toBe("failed");
        expect(failed.message).toBe("failed");
    });

    it("normalizes TaskDto, Suno and Midjourney status vocabularies", () => {
        expect(normalizeAitudouTaskResponse("image", "img_1", { code: "success", data: { task_id: "img_1", status: "NOT_START" } }).phase).toBe("queued");
        expect(normalizeAitudouTaskResponse("audio", "aud_1", { code: "success", data: { task_id: "aud_1", status: "IN_PROGRESS", progress: "55%" } }).progress).toBe(55);
        expect(normalizeAitudouTaskResponse("music", "music_1", { code: 200, data: { task_id: "music_1", status: "completed", progress: 100, result: { music: [] } } }).phase).toBe("succeeded");
        expect(normalizeAitudouTaskResponse("midjourney", "mj_1", { code: 200, data: { task_id: "mj_1", status: "MODAL" } }).phase).toBe("attention");
        const failed = normalizeAitudouTaskResponse("midjourney", "mj_1", { code: 200, data: { task_id: "mj_1", status: "FAILURE", fail_reason: "rejected" } });
        expect(failed.phase).toBe("failed");
        expect(failed.message).toBe("rejected");
    });

    it("accepts each documented successful envelope and rejects explicit API failures", () => {
        expect(() => assertAitudouEnvelope({ id: "vid_1" })).not.toThrow();
        expect(() => assertAitudouEnvelope({ code: "success", data: {} })).not.toThrow();
        expect(() => assertAitudouEnvelope({ code: 200, data: {} })).not.toThrow();
        expect(() => assertAitudouEnvelope({ code: true, data: { amount: 0 } })).not.toThrow();
        expect(() => assertAitudouEnvelope({ code: 401, message: "unauthorized" })).toThrow("unauthorized");
    });
});

describe("Aitudou result mapping", () => {
    it("maps video and last-frame URLs to their corresponding canvas media types", () => {
        const outputs = extractAitudouOutputs({ id: "vid_1", status: "completed", metadata: { url: "https://example/video.mp4", last_frame_url: "https://example/last.png" } }, "video", "vid_1");
        expect(outputs.map((item) => [item.kind, item.url])).toEqual([
            ["video", "https://example/video.mp4"],
            ["image", "https://example/last.png"],
        ]);
    });

    it("maps nested image and audio TaskDto results", () => {
        const image = extractAitudouOutputs({ code: "success", data: { status: "SUCCESS", data: { content: { image_url: "https://example/result.png" } } } }, "image");
        const audio = extractAitudouOutputs({ code: "success", data: { status: "SUCCESS", data: { content: { audio_url: "https://example/result.wav" } } } }, "audio");
        expect(image.some((item) => item.kind === "image" && item.url?.endsWith("result.png"))).toBe(true);
        expect(audio.some((item) => item.kind === "audio" && item.url?.endsWith("result.wav"))).toBe(true);
    });

    it("expands Suno multi-track results and preserves audio indexes", () => {
        const raw = {
            code: 200,
            data: {
                task_id: "music_1",
                status: "completed",
                result: {
                    music: [
                        { audio_id: "a1", title: "Track 1", duration: 120, lyrics: "...", tags: "pop", audio_url: "https://example/a1.mp3", image_url: "https://example/a1.jpg", video_url: "https://example/a1.mp4" },
                        { audio_id: "a2", title: "Track 2", audio_url: "https://example/a2.mp3", image_url: "https://example/a2.jpg" },
                    ],
                },
            },
        };
        const outputs = extractAitudouOutputs(raw, "audio", "music_1");
        expect(outputs.filter((item) => item.kind === "audio").map((item) => item.audioIndex)).toEqual([1, 2]);
        expect(outputs.some((item) => item.kind === "video" && item.url === "https://example/a1.mp4")).toBe(true);
        expect(outputs.some((item) => item.kind === "image" && item.url === "https://example/a1.jpg")).toBe(true);
        expect(outputs.find((item) => item.kind === "image" && item.url === "https://example/a2.jpg")?.audioIndex).toBe(2);
    });

    it("maps Midjourney images, video URL arrays and describe text", () => {
        const imageOutputs = extractAitudouOutputs(
            { code: 200, data: { task_id: "mj_1", status: "SUCCESS", grid_image_url: "https://example/grid.jpg", image_urls: ["https://example/1.jpg", "https://example/2.jpg"], buttons: [{ customId: "U1" }] } },
            "image",
        );
        expect(imageOutputs.filter((item) => item.kind === "image")).toHaveLength(3);
        expect(imageOutputs.filter((item) => item.selectionIndex).map((item) => item.selectionIndex)).toEqual([1, 2]);
        const videoOutputs = extractAitudouOutputs({ code: 200, data: { status: "SUCCESS", video_urls: ["https://example/1.mp4", "https://example/2.mp4"] } }, "video");
        expect(videoOutputs.filter((item) => item.kind === "video")).toHaveLength(2);
        expect(extractAitudouOutputs({ code: 200, data: { status: "SUCCESS", prompt: "a detailed description" } }, "text")[0]?.text).toBe("a detailed description");
    });

    it("extracts chat reasoning/content and synchronous Suno tags", () => {
        expect(extractAitudouText({ choices: [{ message: { content: "answer", reasoning_content: "reasoning" } }] })).toBe("思考过程：\nreasoning\n\nanswer");
        expect(extractAitudouText({ code: 200, data: { result: { upsampled_tags: "cinematic pop" } } })).toBe("cinematic pop");
    });
});

describe("Aitudou transport helpers", () => {
    it("uses only canonical task query paths", () => {
        expect(pollPathForAitudouTask("video", "a/b")).toBe("/v1/videos/a%2Fb");
        expect(pollPathForAitudouTask("image", "1")).toBe("/v1/image/generations/1");
        expect(pollPathForAitudouTask("audio", "1")).toBe("/v1/audio/generations/1");
        expect(pollPathForAitudouTask("midjourney", "1")).toBe("/v1/midjourney/tasks/1");
        expect(pollPathForAitudouTask("music", "1")).toBe("/v1/music/tasks/1");
    });

    it("parses Chat Completions SSE and ignores malformed frames", () => {
        const sse = [
            'data: {"choices":[{"delta":{"reasoning_content":"rea"}}]}',
            "",
            "data: malformed",
            "",
            'data: {"choices":[{"delta":{"reasoning_content":"son","content":"ans"}}]}',
            "",
            'data: {"choices":[{"delta":{"content":"wer"}}]}',
            "",
            "data: [DONE]",
        ].join("\n");
        expect(parseAitudouSse(sse)).toEqual({ content: "answer", reasoning: "reason", text: "思考过程：\nreason\n\nanswer" });
    });
});
