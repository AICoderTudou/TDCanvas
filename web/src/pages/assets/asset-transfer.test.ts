import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        },
    });
});

import { readZip } from "@/lib/zip";
import type { Asset } from "@/stores/use-asset-store";
import { downloadAssetsZip } from "./asset-transfer";

const now = new Date().toISOString();

describe("asset batch downloads", () => {
    it("packages real asset files, keeps custom titles, and uses the canvas title", async () => {
        const assets: Asset[] = [
            { id: "1", kind: "text", title: "分镜说明", coverUrl: "", tags: [], createdAt: now, updatedAt: now, data: { content: "镜头内容" } },
            { id: "2", kind: "image", title: "主视觉", coverUrl: "", tags: [], createdAt: now, updatedAt: now, data: { dataUrl: "blob:image", width: 100, height: 100, bytes: 3, mimeType: "image/png" } },
            { id: "3", kind: "image", title: "主视觉", coverUrl: "", tags: [], createdAt: now, updatedAt: now, data: { dataUrl: "blob:image-2", width: 100, height: 100, bytes: 3, mimeType: "image/png" } },
        ];
        const saveImpl = vi.fn();
        const resolveBlobImpl = vi.fn(async () => new Blob(["png"], { type: "image/png" }));

        const result = await downloadAssetsZip(assets, "敦煌画布", { saveImpl, resolveBlobImpl });
        const [zip, filename] = saveImpl.mock.calls[0];
        const files = await readZip(zip);

        expect(result).toEqual({ filename: "敦煌画布.zip", downloaded: 3, skipped: 0 });
        expect(filename).toBe("敦煌画布.zip");
        expect(Array.from(files.keys())).toEqual(["分镜说明.txt", "主视觉.png", "主视觉 (2).png"]);
    });
});
