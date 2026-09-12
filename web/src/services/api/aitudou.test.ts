import { describe, expect, it, vi } from "vitest";

import {
    AITUDOU_OFFICIAL_BASE_URL,
    AitudouApiError,
    AitudouPollingStoppedError,
    checkAitudouActionRegistries,
    describeAitudouError,
    prepareAitudouPayload,
    resolveAitudouApiBase,
    resumeAitudouTasks,
    runAitudouOperation,
    runAitudouOperationBatch,
    validateAitudouPayload,
} from "./aitudou";
import { AITUDOU_OPERATIONS, getAitudouOperation } from "./aitudou-contract";
import { getAitudouModelProfile } from "./aitudou-models";
import { persistAitudouRunResult } from "./aitudou-storage";
import { journalAitudouSubmission, mergeAitudouTaskJournal } from "./aitudou-task-journal";

const jsonResponse = (value: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json", ...(init.headers || {}) },
        ...init,
    });

describe("Aitudou request transport", () => {
    it("normalizes official/custom root URLs without appending v1 to /api routes", () => {
        expect(resolveAitudouApiBase("")).toBe(AITUDOU_OFFICIAL_BASE_URL);
        expect(resolveAitudouApiBase("https://api.aitudou.net/v1/")).toBe(AITUDOU_OFFICIAL_BASE_URL);
        expect(resolveAitudouApiBase("https://proxy.example/root/")).toBe("https://proxy.example/root");
    });

    it("resolves exact canvas placeholders without altering prompt substrings", async () => {
        let uploadIndex = 0;
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            const url = String(input);
            if (url === "https://cdn.example/image.png") return new Response(new Blob(["image"], { type: "image/png" }));
            uploadIndex += 1;
            return jsonResponse({ url: `https://cdn.example/fresh-${uploadIndex}.png`, expires_in: 86400 });
        });
        const payload = await prepareAitudouPayload(
            { apiKey: "sk-test" },
            getAitudouOperation("video.generate"),
            {
                prompt: "Use @Image 1 as a phrase, but keep it inside this longer sentence",
                images: ["@Image 1"],
                metadata: { content: [{ type: "audio_url", audio_url: { url: "@Audio 1" } }] },
                task_id: "@Task 1",
                audio_index: "@TaskAudioIndex 1",
                note: "@Text 1",
            },
            [
                { kind: "image", name: "image.png", url: "https://cdn.example/image.png" },
                { kind: "audio", name: "audio.mp3", url: "https://cdn.example/audio.mp3" },
                { kind: "task", name: "parent", taskId: "task_parent", audioIndex: 2 },
                { kind: "text", name: "prompt", text: "connected text" },
            ],
            fetchImpl,
        );
        expect(payload.prompt).toContain("Use @Image 1 as a phrase");
        expect(payload.images).toEqual(["https://cdn.example/fresh-1.png"]);
        expect(payload.metadata).toEqual({ content: [{ type: "audio_url", audio_url: { url: "https://cdn.example/audio.mp3" } }] });
        expect(payload.task_id).toBe("task_parent");
        expect(payload.audio_index).toBe(2);
        expect(payload.note).toBe("connected text");
        expect(fetchImpl).toHaveBeenCalledTimes(2);

        const sunoFollowup = await prepareAitudouPayload(
            { apiKey: "sk-test" },
            getAitudouOperation("suno.extend"),
            getAitudouOperation("suno.extend").defaultPayload,
            [{ kind: "task", name: "second track", taskId: "music_parent", audioIndex: 2 }],
            fetchImpl,
        );
        expect(sunoFollowup).toEqual(expect.objectContaining({ task_id: "music_parent", audio_index: 2 }));

        const sunoMashup = await prepareAitudouPayload(
            { apiKey: "sk-test" },
            getAitudouOperation("suno.mashup"),
            getAitudouOperation("suno.mashup").defaultPayload,
            [
                { kind: "task", name: "second track A", taskId: "music_a", audioIndex: 2 },
                { kind: "task", name: "second track B", taskId: "music_b", audioIndex: 3 },
            ],
            fetchImpl,
        );
        expect(sunoMashup).toEqual(expect.objectContaining({ task_ids: ["music_a", "music_b"], audio_indexes: [2, 3] }));

        const sameTaskMashup = await prepareAitudouPayload(
            { apiKey: "sk-test" },
            getAitudouOperation("suno.mashup"),
            getAitudouOperation("suno.mashup").defaultPayload,
            [
                { kind: "task", name: "first track", taskId: "music_pair", audioIndex: 1 },
                { kind: "task", name: "second track", taskId: "music_pair", audioIndex: 2 },
            ],
            fetchImpl,
        );
        expect(sameTaskMashup).toEqual(expect.objectContaining({ task_ids: ["music_pair", "music_pair"], audio_indexes: [1, 2] }));

        const midjourneyFollowup = await prepareAitudouPayload(
            { apiKey: "sk-test" },
            getAitudouOperation("midjourney.upscale"),
            getAitudouOperation("midjourney.upscale").defaultPayload,
            [{ kind: "task", name: "U2", taskId: "mj_parent", selectionIndex: 2 }],
            fetchImpl,
        );
        expect(midjourneyFollowup).toEqual(expect.objectContaining({ task_id: "mj_parent", index: 2 }));

        const midjourneyVideo = await prepareAitudouPayload(
            { apiKey: "sk-test" },
            getAitudouOperation("midjourney.video"),
            getAitudouOperation("midjourney.video").defaultPayload,
            [{ kind: "task", name: "U2", taskId: "mj_parent", selectionIndex: 2 }],
            fetchImpl,
        );
        expect(midjourneyVideo).toEqual(expect.objectContaining({ task_id: "mj_parent", index: 1 }));
    });

    it("refreshes an HTTPS image reference instead of passing an expiring provider URL to a new task", async () => {
        const expiredSoonUrl = "https://temporary.example/old-image.png";
        const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
            if (String(input) === expiredSoonUrl) return new Response(new Blob(["local-image-copy"], { type: "image/png" }));
            expect(init?.body).toBeInstanceOf(FormData);
            return jsonResponse({ url: "https://api.aitudou.net/fresh-reference.png", expires_in: 86400 });
        });

        const payload = await prepareAitudouPayload(
            { apiKey: "sk-test" },
            getAitudouOperation("image.generate"),
            { model: "seedream-v5-pro-i2i", prompt: "valid prompt", images: ["@Image 1"] },
            [{ kind: "image", name: "old-image.png", url: expiredSoonUrl }],
            fetchImpl,
        );

        expect(payload.images).toEqual(["https://api.aitudou.net/fresh-reference.png"]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("reports a recoverable message when both an old image URL and its local copy are gone", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 410 }));
        await expect(
            prepareAitudouPayload(
                { apiKey: "sk-test" },
                getAitudouOperation("image.generate"),
                { model: "seedream-v5-pro-i2i", prompt: "valid prompt", images: ["@Image 1"] },
                [{ kind: "image", name: "lost-image.png", url: "https://temporary.example/lost.png" }],
                fetchImpl,
            ),
        ).rejects.toThrow("原地址已失效");
    });

    it("uploads local canvas blobs as multipart and does not set a manual boundary", async () => {
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            calls.push({ input: url, init });
            if (url === "blob:local-image") return new Response(new Blob(["image"], { type: "image/png" }), { status: 200 });
            return jsonResponse({ url: "https://cdn.example/upload.png", file_type: "image/png", size: 5, expires_in: 86400 });
        });
        const payload = await prepareAitudouPayload(
            { apiKey: "sk-test" },
            getAitudouOperation("image.generate"),
            { model: "seedream-v5-pro-t2i", prompt: "test prompt", images: ["@Image 1"] },
            [{ kind: "image", name: "local.png", url: "blob:local-image" }],
            fetchImpl,
        );
        expect(payload.images).toEqual(["https://cdn.example/upload.png"]);
        expect(calls).toHaveLength(2);
        expect(calls[1].input).toBe("https://api.aitudou.net/v1/files/upload");
        expect(calls[1].init?.body).toBeInstanceOf(FormData);
        expect(new Headers(calls[1].init?.headers).has("Content-Type")).toBe(false);
        expect(new Headers(calls[1].init?.headers).get("Authorization")).toBe("Bearer sk-test");
    });

    it("runs the explicit upload operation with its file supplied by the connected node", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            if (String(input) === "blob:upload-image") return new Response(new Blob(["image"], { type: "image/png" }), { status: 200 });
            return jsonResponse({ url: "https://cdn.example/uploaded.png", expires_in: 86400 });
        });
        const result = await runAitudouOperation({ apiKey: "sk-test" }, "utility.upload", {}, { fetchImpl, references: [{ kind: "image", name: "canvas.png", url: "blob:upload-image" }] });
        expect(result.outputs).toEqual([expect.objectContaining({ kind: "text", url: "https://cdn.example/uploaded.png" })]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("transcribes an official m4a/mp4 input and appends exactly one multipart file", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
            if (String(input) === "blob:voice-m4a") return new Response(new Blob(["voice"], { type: "audio/mp4" }), { status: 200 });
            const form = init?.body as FormData;
            expect(form.getAll("file")).toHaveLength(1);
            expect(form.get("model")).toBe("whisper-1");
            return jsonResponse({ text: "transcribed" });
        });
        const result = await runAitudouOperation({ apiKey: "sk-test" }, "audio.transcribe", { model: "whisper-1", file: "this field must not be duplicated" }, { fetchImpl, references: [{ kind: "audio", name: "voice.m4a", url: "blob:voice-m4a" }] });
        expect(result.outputs).toEqual([expect.objectContaining({ kind: "text", text: "transcribed" })]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("runs an async image task through submitted, polling and media mapping", async () => {
        const responses = [
            jsonResponse({ id: "img_1", task_id: "img_1", status: "queued" }),
            jsonResponse({ code: "success", data: { task_id: "img_1", status: "IN_PROGRESS", progress: "40%" } }),
            jsonResponse({ code: "success", data: { task_id: "img_1", status: "SUCCESS", progress: "100%", result_url: "https://cdn.example/result.png" } }),
        ];
        const urls: string[] = [];
        const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
            urls.push(String(input));
            if (urls.length === 1) {
                expect(init?.method).toBe("POST");
                expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-test");
            }
            return responses.shift()!;
        });
        const submitted = vi.fn();
        const updates = vi.fn();
        const result = await runAitudouOperation({ apiKey: "sk-test" }, "image.generate", { model: "seedream-v5-pro-t2i", prompt: "test prompt" }, { fetchImpl, pollIntervalMs: 0, onSubmitted: submitted, onUpdate: updates });
        expect(urls).toEqual(["https://api.aitudou.net/v1/image/generations", "https://api.aitudou.net/v1/image/generations/img_1", "https://api.aitudou.net/v1/image/generations/img_1"]);
        expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ taskId: "img_1", remoteRunning: true }));
        expect(updates).toHaveBeenCalledTimes(2);
        expect(result.status).toBe("succeeded");
        expect(result.outputs).toEqual([expect.objectContaining({ kind: "image", url: "https://cdn.example/result.png", taskId: "img_1" })]);
    });

    it("submits a canvas image batch as separate documented single-result tasks", async () => {
        let submissionIndex = 0;
        const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
            if (init?.method === "POST") {
                submissionIndex += 1;
                return jsonResponse({ id: `img_batch_${submissionIndex}`, task_id: `img_batch_${submissionIndex}`, status: "queued" });
            }
            const taskId = String(input).split("/").pop()!;
            return jsonResponse({ code: "success", data: { task_id: taskId, status: "SUCCESS", result_url: `https://cdn.example/${taskId}.png` } });
        });
        const submitted = vi.fn();
        const result = await runAitudouOperationBatch({ apiKey: "sk-test" }, "image.generate", { model: "seedream-v5-pro-t2i", prompt: "test prompt" }, 4, { fetchImpl, pollIntervalMs: 0, onSubmitted: submitted });
        expect(submitted).toHaveBeenCalledTimes(4);
        expect(fetchImpl).toHaveBeenCalledTimes(8);
        expect(result.status).toBe("succeeded");
        expect(result.taskIds).toEqual(["img_batch_1", "img_batch_2", "img_batch_3", "img_batch_4"]);
        expect(result.outputs).toHaveLength(4);
        expect(result.outputs).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: "img_batch_4", url: "https://cdn.example/img_batch_4.png" })]));
    });

    it("resumes every persisted task id and preserves each output lineage", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            const taskId = String(input).endsWith("/img_2") ? "img_2" : "img_1";
            return jsonResponse({ code: "success", data: { task_id: taskId, status: "SUCCESS", result_url: `https://cdn.example/${taskId}.png` } });
        });
        const result = await resumeAitudouTasks({ apiKey: "sk-test" }, "image.generate", ["img_1", "img_2", "img_1"], { fetchImpl, pollIntervalMs: 0 });
        expect(result.taskIds).toEqual(["img_1", "img_2"]);
        expect(result.outputs).toEqual([expect.objectContaining({ url: "https://cdn.example/img_1.png", taskId: "img_1" }), expect.objectContaining({ url: "https://cdn.example/img_2.png", taskId: "img_2" })]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("returns successful paid outputs when a sibling task fails", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            if (String(input).endsWith("/img_failed")) return jsonResponse({ code: "success", data: { task_id: "img_failed", status: "FAILED", fail_reason: "rejected" } });
            return jsonResponse({ code: "success", data: { task_id: "img_ok", status: "SUCCESS", result_url: "https://cdn.example/img_ok.png" } });
        });
        const result = await resumeAitudouTasks({ apiKey: "sk-test" }, "image.generate", ["img_ok", "img_failed"], { fetchImpl, pollIntervalMs: 0 });
        expect(result.status).toBe("partial");
        expect(result.outputs).toEqual([expect.objectContaining({ url: "https://cdn.example/img_ok.png", taskId: "img_ok" })]);
        expect(result.taskStates).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: "img_failed", phase: "failed" })]));
    });

    it("keeps interrupted sibling tasks resumable when another paid output succeeds", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
            if (String(input).endsWith("/img_interrupted")) throw new TypeError("network unavailable");
            return jsonResponse({ code: "success", data: { task_id: "img_ok", status: "SUCCESS", result_url: "https://cdn.example/img_ok.png" } });
        });
        const result = await resumeAitudouTasks({ apiKey: "sk-test" }, "image.generate", ["img_ok", "img_interrupted"], { fetchImpl, pollIntervalMs: 0 });
        expect(result.status).toBe("partial");
        expect(result.outputs).toEqual([expect.objectContaining({ url: "https://cdn.example/img_ok.png", taskId: "img_ok" })]);
        expect(result.taskStates).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: "img_interrupted", phase: "running", status: "polling_interrupted" })]));
    });

    it("downloads completed media immediately and keeps the original URL as lineage", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) => new Response(new Blob([String(input)], { type: String(input).endsWith(".png") ? "image/png" : "video/mp4" }), { status: 200 }));
        const storeImage = vi.fn(async () => ({ url: "blob:stored-image", storageKey: "image:one", width: 1024, height: 1024, bytes: 5, mimeType: "image/png" }));
        const storeMedia = vi.fn(async () => ({ url: "blob:stored-video", storageKey: "aitudou-video:one", width: 1280, height: 720, durationMs: 5000, bytes: 6, mimeType: "video/mp4" }));
        const persisted = await persistAitudouRunResult(
            {
                operationId: "midjourney.video",
                status: "succeeded",
                taskIds: ["task_1"],
                outputs: [
                    { kind: "image", url: "https://cdn.example/result.png", taskId: "task_1" },
                    { kind: "video", url: "https://cdn.example/result.mp4", taskId: "task_1" },
                    { kind: "text", text: "kept as text" },
                ],
                raw: {},
                taskStates: [],
            },
            { fetchImpl, storeImage, storeMedia },
        );
        expect(persisted.failures).toEqual([]);
        expect(persisted.result.outputs).toEqual([
            expect.objectContaining({ url: "blob:stored-image", sourceUrl: "https://cdn.example/result.png", storageKey: "image:one" }),
            expect.objectContaining({ url: "blob:stored-video", sourceUrl: "https://cdn.example/result.mp4", storageKey: "aitudou-video:one" }),
            { kind: "text", text: "kept as text" },
        ]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("recovers every submitted task synchronously from the local journal after a hard refresh", () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) || null,
            setItem: (key: string, value: string) => void values.set(key, value),
            removeItem: (key: string) => void values.delete(key),
        };
        const node = { id: "node_1", type: "aitudou", title: "AI 土豆任务", position: { x: 10, y: 20 }, width: 320, height: 220, metadata: { aitudouOperation: "image.generate" } };
        for (const taskId of ["img_1", "img_2"]) {
            expect(
                journalAitudouSubmission(
                    {
                        projectId: "project_1",
                        node,
                        operationId: "image.generate",
                        channelId: "channel_1",
                        submission: { operationId: "image.generate", family: "image", taskId, pollPath: `/v1/image/generations/${taskId}`, remoteRunning: true, raw: {} },
                    },
                    storage,
                ),
            ).toBe(true);
        }
        const recovered = mergeAitudouTaskJournal("project_1", [{ ...node, metadata: { ...node.metadata, channelId: "stale_channel", aitudouOperation: "video.generate" } }], storage);
        expect(recovered).toHaveLength(1);
        expect(recovered[0].metadata?.providerTask).toEqual(expect.objectContaining({ taskId: "img_1", taskIds: ["img_1", "img_2"], phase: "stopped", status: "recovered_from_journal" }));
        expect(recovered[0].metadata?.channelId).toBe("channel_1");
        expect(recovered[0].metadata?.aitudouOperation).toBe("image.generate");
        mergeAitudouTaskJournal("project_1", recovered, storage);
        expect(values.size).toBe(0);
    });

    it("handles Chat Completions SSE without polling", async () => {
        const sse = ['data: {"choices":[{"delta":{"reasoning_content":"why"}}]}', "", 'data: {"choices":[{"delta":{"content":"answer"}}]}', "", "data: [DONE]"].join("\n");
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
        const result = await runAitudouOperation({ apiKey: "sk-test" }, "text.chat", { model: "kimi-k3", stream: true, messages: [{ role: "user", content: "hello" }] }, { fetchImpl });
        expect(result.taskIds).toEqual([]);
        expect(result.outputs[0]).toEqual({ kind: "text", text: "思考过程：\nwhy\n\nanswer" });
    });

    it("makes Abort stop only local polling and retains the remote submission", async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ id: "vid_remote", status: "queued" }));
        const promise = runAitudouOperation(
            { apiKey: "sk-test" },
            "video.generate",
            { model: "seedance-2.0-standard-t2v", prompt: "test" },
            {
                fetchImpl,
                signal: controller.signal,
                pollIntervalMs: 0,
                onSubmitted: () => controller.abort(),
            },
        );
        const error = await promise.catch((reason) => reason as unknown);
        expect(error).toBeInstanceOf(AitudouPollingStoppedError);
        expect((error as AitudouPollingStoppedError).remoteContinues).toBe(true);
        expect((error as AitudouPollingStoppedError).submission.taskId).toBe("vid_remote");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("maps HTTP errors, Retry-After and redacts API keys", async () => {
        const fetchImpl = vi.fn<typeof fetch>(
            async () =>
                new Response(JSON.stringify({ error: { code: "rate_limit", message: "retry sk-super-secret-key-now" } }), {
                    status: 429,
                    headers: { "Content-Type": "application/json", "Retry-After": "2" },
                }),
        );
        const error = await runAitudouOperation({ apiKey: "sk-test" }, "utility.wallet", {}, { fetchImpl }).catch((reason) => reason as unknown);
        expect(error).toBeInstanceOf(AitudouApiError);
        expect((error as AitudouApiError).status).toBe(429);
        expect((error as AitudouApiError).retryAfterMs).toBe(2000);
        expect((error as Error).message).not.toContain("super-secret");
    });

    it("keeps the complete Midjourney request and nested server response for diagnosis", async () => {
        const prompt = "two adult anime blade fighters::2 --ar 16:9 --stylize 500 --chaos 9 --niji 7";
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse(
                {
                    code: "VALIDATION_ERROR",
                    detail: [{ loc: ["body", "prompt"], msg: "model version conflicts with prompt parameter", type: "value_error" }],
                    trace_id: "trace_mj_1",
                },
                { status: 400 },
            ),
        );

        const error = await runAitudouOperation({ apiKey: "sk-real-secret-value" }, "midjourney.imagine", { prompt, version: "8.1", niji: false, size: "16:9", stylize: 500, chaos: 9 }, { fetchImpl }).catch((reason) => reason as unknown);

        expect(error).toBeInstanceOf(AitudouApiError);
        expect((error as Error).message).toContain("body.prompt: model version conflicts");
        expect((error as AitudouApiError).details).toContain("POST /v1/midjourney/generations");
        expect((error as AitudouApiError).details).toContain(prompt);
        expect((error as AitudouApiError).details).toContain('"trace_id": "trace_mj_1"');
        expect((error as AitudouApiError).details).not.toContain("real-secret-value");

        const described = describeAitudouError(error, { operationId: "midjourney.imagine", payload: { prompt } });
        expect(described.summary).toContain("HTTP 400");
        expect(described.details).toContain("画布提交参数");
        expect(described.details).toContain("服务端原始响应");
    });
});

describe("Aitudou payload constraints", () => {
    it("enforces exact documented mutually exclusive/reference constraints", () => {
        expect(() =>
            validateAitudouPayload(getAitudouOperation("audio.generate"), {
                model: "doubao-seed-audio-1.0",
                prompt: "hello",
                images: ["https://example/image.png"],
                metadata: { speaker: "speaker-id" },
            }),
        ).toThrow("互斥");
        expect(() =>
            validateAitudouPayload(getAitudouOperation("video.generate"), {
                model: "seedance-2.0-standard-multi",
                prompt: "hello",
                images: ["https://example/image.png"],
                metadata: { content: [{ type: "image_url", image_url: { url: "https://example/image.png" } }] },
            }),
        ).toThrow("不能同时发送");
        expect(() => validateAitudouPayload(getAitudouOperation("midjourney.blend"), { image_urls: ["one"] })).toThrow("2–4");
        expect(() => validateAitudouPayload(getAitudouOperation("suno.mashup"), { model: "suno", task_ids: ["one"] })).toThrow("2");
        expect(() => validateAitudouPayload(getAitudouOperation("midjourney.upscale"), { task_id: "parent" })).toThrow("index 或 custom_id");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "seedance-2.0-standard-t2v", prompt: "hello", seconds: "16" })).toThrow("不能大于 15");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "seedance-2.0-standard-t2v", prompt: "hello", seconds: "-1" })).toThrow("明确的正整数字符串");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "seedance-2.0-standard-t2v", prompt: "hello", seconds: 5 })).toThrow("整数字符串");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "seedance-2.0-standard-t2v", prompt: "hello", seconds: "abc" })).toThrow("整数字符串");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "seedance-2.0-standard-t2v", prompt: "hello", seconds: "5", metadata: { ratio: "adaptive" } })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "minimax-h3-ow-i2v", prompt: "hello", images: ["https://example/first.png", "https://example/second.png"], seconds: "5" })).toThrow("最多允许 1 个图片输入");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "seedance-2.0-standard-multi", prompt: "hello" })).toThrow("metadata.content");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "hailuo-h3-multi", prompt: "hello", images: ["https://example/image.png"], seconds: "5", metadata: { resolution: "768P" } })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "hailuo-h3-multi", prompt: "hello", seconds: "5" })).toThrow("images、video_url 或 audio_url");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "aitudou-video-g-omni-flash", prompt: "hello", metadata: { resolution: "720p", ratio: "16:9" } })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "aitudou-video-g-omni-flash", metadata: { video_url: "https://example/video.mp4", extend_from_task_id: "task" } })).toThrow("互斥");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "aitudou-video-g-omni-flash", prompt: "hello", seconds: "5" })).toThrow("不可指定时长");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "happyhorse-1.1-r2v", prompt: "hello" })).toThrow("至少 1 张参考图片");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "happyhorse-1.1-r2v", prompt: "hello", images: ["https://example/image.png"], seconds: "5" })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "flux-3-video-v2v", prompt: "hello" })).toThrow("metadata.video_url");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "flux-3-video-v2v", prompt: "hello", metadata: { video_url: "https://example/video.mp4" } })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "flux-3-video-draft-enhance", prompt: "hello" })).toThrow("metadata.draft_cache");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "flux-3-video-draft-enhance", metadata: { draft_cache: "draft-cache" } })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "kling-o3-std-edit", prompt: "hello" })).toThrow("video_url");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "kling-v3.0-std-motion", prompt: "hello", video_url: "https://example/video.mp4" })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "vidu-q3-pro-start-end", prompt: "hello", images: ["https://example/start.png"] })).toThrow("首、尾 2 张");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "vidu-q3-pro-start-end", prompt: "hello", images: ["https://example/start.png", "https://example/end.png"] })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "seedream-v5-pro-t2i", prompt: "tiny" })).toThrow("至少需要 5");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "seedream-v5-pro-i2i", prompt: "valid prompt" })).toThrow("至少 1 张参考图片");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "seedream-v5-pro-t2i", prompt: "valid prompt", metadata: { output_format: "webp" } })).toThrow("jpeg 或 png");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "seedream-v5-pro-t2i", prompt: "valid prompt", metadata: { width: 200 } })).toThrow("240 到 8192");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "seedream-v5-pro-t2i", prompt: "valid prompt", metadata: { width: 1024 } })).toThrow("必须成对提供");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "seedream-v5-pro-t2i", prompt: "valid prompt", metadata: { width: 1024, height: 1024, resolution: "1k" } })).toThrow("不能与 metadata.resolution 同时提供");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "seedream-v5-pro-t2i", prompt: "valid prompt", metadata: { width: 1024, height: 1024 } })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "aitudou-image-g2-t2i", prompt: "valid prompt", metadata: { resolution: "1k", ratio: "16:9" } })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "aitudou-image-g2-t2i", prompt: "valid prompt", metadata: { resolution: "1k", ratio: "4:3" } })).toThrow("16:9、9:16、1:1");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "qwen-image-3.0-pro-t2i", prompt: "valid prompt", metadata: { resolution: "2k", ratio: "21:9" } })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "qwen-image-3.0-pro-t2i", prompt: "valid prompt", metadata: { resolution: "2k", ratio: "7:5" } })).toThrow("ratio 只允许");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "qwen-image-3.0-pro-t2i", prompt: "valid prompt", metadata: { resolution: "2k", ratio: "wide" } })).toThrow("ratio 只允许");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "qwen-image-3.0-pro-t2i", prompt: "valid prompt", n: 0 })).toThrow("从 1 开始的整数");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "qwen-image-3.0-pro-t2i", prompt: "valid prompt", n: 1.5 })).toThrow("从 1 开始的整数");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "qwen-image-3.0-pro-t2i", prompt: "valid prompt", n: 7 })).toThrow("最多生成 6");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "seedream-v5-pro-t2i", prompt: "valid prompt", n: 2 })).toThrow("固定生成 1");
        expect(() => validateAitudouPayload(getAitudouOperation("midjourney.imagine"), { prompt: "valid prompt", repeat: 1 })).toThrow("2 到 40");
        expect(() => validateAitudouPayload(getAitudouOperation("midjourney.imagine"), { prompt: "valid prompt", repeat: 40, speed: "turbo", size: "16:9", hd: true })).not.toThrow();
        expect(() => validateAitudouPayload(getAitudouOperation("midjourney.imagine"), { prompt: "valid prompt", repeat: 41 })).toThrow("2 到 40");
        expect(() =>
            validateAitudouPayload(getAitudouOperation("image.generate"), {
                model: "aitudou-image-g-v2-lowprice",
                prompt: "valid prompt",
                n: 10,
                size: "21:9",
                metadata: { resolution: "4k" },
            }),
        ).not.toThrow();
        expect(() =>
            validateAitudouPayload(getAitudouOperation("image.generate"), {
                model: "aitudou-image-g-v2-lowprice",
                prompt: "valid prompt",
                n: 1,
                size: "1:1",
                metadata: { resolution: "4k" },
            }),
        ).toThrow("当前分辨率的 size 只允许");
        expect(() => validateAitudouPayload(getAitudouOperation("video.generate"), { model: "hailuo-h3-t2v", prompt: "valid prompt", seconds: "5", metadata: { resolution: "768P", ratio: "7:5" } })).not.toThrow();
        expect(getAitudouModelProfile("hailuo-h3-multi")?.constraints?.allowCustomRatio).toBe(true);
        expect(getAitudouModelProfile("aitudou-video-g-omni-flash")?.constraints?.allowCustomRatio).toBe(true);
        expect(() => validateAitudouPayload(getAitudouOperation("audio.generate"), { model: "doubao-seed-audio-1.0", prompt: "valid prompt", metadata: { speech_rate: 101 } })).toThrow("-50 到 100");
        expect(() => validateAitudouPayload(getAitudouOperation("audio.generate"), { model: "doubao-seed-audio-1.0", prompt: "valid prompt", metadata: { sample_rate: 24000 } })).toThrow("必须是字符串");
        expect(() => validateAitudouPayload(getAitudouOperation("suno.generate"), { model: "suno", version: "v5.5" })).toThrow("必须提供 prompt");
        expect(() => validateAitudouPayload(getAitudouOperation("image.generate"), { model: "made-up-model", prompt: "hello" })).toThrow("避免猜测");
    });

    it("checks live registry response shape against the local public-action snapshot", async () => {
        const music = AITUDOU_OPERATIONS.filter((item) => item.group === "suno").map((item) => ({
            public_action: item.id === "suno.generate" ? "" : item.id.slice("suno.".length),
            required_fields: item.requiredFields,
            sync: Boolean(item.sync),
        }));
        const midjourney = AITUDOU_OPERATIONS.filter((item) => item.group === "midjourney").map((item) => ({
            public_action: item.id.slice("midjourney.".length),
            required_fields: item.requiredFields,
            sync: Boolean(item.sync),
        }));
        // The live MJ registry contains a base alias plus the imagine record.
        midjourney.unshift({ public_action: "", required_fields: ["prompt"], sync: false });
        const fetchImpl = vi.fn<typeof fetch>(async (input) => jsonResponse({ success: true, data: String(input).includes("music") ? music : midjourney }));
        const result = await checkAitudouActionRegistries({ apiKey: "" }, fetchImpl);
        expect(result.ok).toBe(true);
        expect(result.music).toEqual(expect.objectContaining({ missing: [], unexpected: [] }));
        expect(result.midjourney).toEqual(expect.objectContaining({ missing: [], unexpected: [] }));
    });

    const liveContractTest = process.env.AITUDOU_LIVE === "1" ? it : it.skip;
    liveContractTest("matches the two live no-charge official action registries", async () => {
        const result = await checkAitudouActionRegistries();
        expect(result.music.actual).toHaveLength(31);
        expect(result.midjourney.actual).toHaveLength(16);
        expect(result.music.missing).toEqual([]);
        expect(result.music.unexpected).toEqual([]);
        expect(result.music.contractMismatches).toEqual([]);
        expect(result.midjourney.missing).toEqual([]);
        expect(result.midjourney.unexpected).toEqual([]);
        expect(result.midjourney.contractMismatches).toEqual([]);
        expect(result.midjourney.documentedConflicts).toEqual([expect.stringContaining("midjourney.describe.required_fields")]);
        expect(result.ok).toBe(true);
    });
});
