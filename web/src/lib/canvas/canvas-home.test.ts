import { describe, expect, it } from "vitest";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

import { latestCanvasProjectId, latestGeneratedCanvasMedia, sortCanvasProjectsByRecent } from "./canvas-home";

const project = (id: string, updatedAt: string): CanvasProject => ({
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
});

describe("canvas home project ordering", () => {
    it("orders projects by their actual update time without mutating persisted order", () => {
        const projects = [project("older", "2026-01-01T00:00:00.000Z"), project("latest", "2026-08-23T12:00:00.000Z"), project("middle", "2026-05-01T00:00:00.000Z")];

        expect(sortCanvasProjectsByRecent(projects).map((item) => item.id)).toEqual(["latest", "middle", "older"]);
        expect(projects.map((item) => item.id)).toEqual(["older", "latest", "middle"]);
        expect(latestCanvasProjectId(projects)).toBe("latest");
    });

    it("keeps invalid legacy timestamps at the end", () => {
        expect(sortCanvasProjectsByRecent([project("legacy", "invalid"), project("valid", "2026-08-23T12:00:00.000Z")]).map((item) => item.id)).toEqual(["valid", "legacy"]);
        expect(latestCanvasProjectId([])).toBeUndefined();
    });

    it("uses the newest generated visual as the project cover and ignores uploads", () => {
        const canvas = project("cover", "2026-08-23T12:00:00.000Z");
        canvas.nodes = [
            {
                id: "upload",
                type: CanvasNodeType.Image,
                title: "参考图",
                position: { x: 0, y: 0 },
                width: 320,
                height: 180,
                metadata: { content: "blob:upload", sourceOrigin: "upload" },
            },
            {
                id: "generated",
                type: CanvasNodeType.Image,
                title: "生成图",
                position: { x: 400, y: 0 },
                width: 320,
                height: 180,
                metadata: {
                    content: "blob:selected-old-version",
                    providerTask: { provider: "aitudou", completedAt: "2026-08-23T12:00:00.000Z" },
                    imageHistory: [
                        { id: "old", content: "blob:old", createdAt: "2026-08-23T11:00:00.000Z" },
                        { id: "latest", content: "asset://latest", localPath: "C:\\cache\\latest.webp", filename: "latest.webp", createdAt: "2026-08-23T12:00:00.000Z" },
                    ],
                    activeImageHistoryId: "old",
                },
            },
        ];

        expect(latestGeneratedCanvasMedia(canvas)).toMatchObject({ kind: "image", url: "asset://latest", localPath: "C:\\cache\\latest.webp" });
    });

    it("supports a generated video as the latest project cover", () => {
        const canvas = project("video-cover", "2026-08-23T13:00:00.000Z");
        canvas.nodes = [
            {
                id: "video",
                type: CanvasNodeType.Video,
                title: "生成视频",
                position: { x: 0, y: 0 },
                width: 320,
                height: 180,
                metadata: {
                    content: "asset://video",
                    localPath: "C:\\cache\\video.mp4",
                    providerTask: { provider: "aitudou", completedAt: "2026-08-23T13:00:00.000Z" },
                },
            },
        ];

        expect(latestGeneratedCanvasMedia(canvas)).toMatchObject({ kind: "video", url: "asset://video", localPath: "C:\\cache\\video.mp4" });
    });
});
