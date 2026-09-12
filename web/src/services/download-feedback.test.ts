import { describe, expect, it } from "vitest";

import { captureDownloadFeedback, emitDownloadComplete } from "./download-feedback";

describe("download feedback", () => {
    it("keeps an image preview but never treats video media as an image thumbnail", () => {
        const image = captureDownloadFeedback("image", "frame.png", "blob:frame");
        const video = captureDownloadFeedback("video", "clip.mp4", "blob:clip");

        expect(image).toMatchObject({ kind: "image", filename: "frame.png", previewUrl: "blob:frame", origin: { x: 0, y: 0 } });
        expect(video).toMatchObject({ kind: "video", filename: "clip.mp4", origin: { x: 0, y: 0 } });
        expect(video.previewUrl).toBeUndefined();
        expect(() => emitDownloadComplete(image)).not.toThrow();
    });
});
