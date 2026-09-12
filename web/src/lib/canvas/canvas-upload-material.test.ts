import { describe, expect, it } from "vitest";

import { CANVAS_MATERIAL_MAX_BYTES, validateCanvasMaterialFile } from "./canvas-upload-material";

describe("validateCanvasMaterialFile", () => {
    it.each([
        ["reference.webp", "image/webp", "image"],
        ["clip.mov", "video/quicktime", "video"],
        ["voice.flac", "audio/flac", "audio"],
    ] as const)("classifies %s from the documented MIME list", (name, type, kind) => {
        expect(validateCanvasMaterialFile({ name, type, size: 1024 })).toEqual({ ok: true, kind });
    });

    it("uses a documented extension when the browser omits MIME", () => {
        expect(validateCanvasMaterialFile({ name: "reference.mkv", type: "", size: 1024 })).toEqual({ ok: true, kind: "video" });
    });

    it("rejects unsupported formats before storing them", () => {
        expect(validateCanvasMaterialFile({ name: "animation.gif", type: "image/gif", size: 1024 })).toEqual({ ok: false, reason: "unsupported" });
    });

    it("rejects files above the official 50 MB upload limit", () => {
        expect(validateCanvasMaterialFile({ name: "too-large.mp4", type: "video/mp4", size: CANVAS_MATERIAL_MAX_BYTES + 1 })).toEqual({ ok: false, reason: "too-large" });
    });
});
