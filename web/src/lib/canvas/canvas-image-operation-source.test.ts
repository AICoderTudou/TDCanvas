import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
            clear: () => values.clear(),
        },
    });
});

import { withCanvasImageOperationSource } from "./canvas-image-operation-source";

describe("withCanvasImageOperationSource", () => {
    it("resolves generated image metadata to a local Blob URL before editing", async () => {
        const blob = new Blob(["generated"], { type: "image/png" });
        const resolveBlob = vi.fn(async () => blob);
        const createObjectURL = vi.fn(() => "blob:local-generated-image");
        const revokeObjectURL = vi.fn();
        const operation = vi.fn(async (url: string) => `cropped:${url}`);

        const result = await withCanvasImageOperationSource({ url: "https://cdn.example/generated.png", storageKey: "image:generated", mimeType: "image/png" }, operation, { resolveBlob, createObjectURL, revokeObjectURL });

        expect(resolveBlob).toHaveBeenCalledWith({ kind: "image", url: "https://cdn.example/generated.png", storageKey: "image:generated", mimeType: "image/png" });
        expect(createObjectURL).toHaveBeenCalledWith(blob);
        expect(operation).toHaveBeenCalledWith("blob:local-generated-image");
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-generated-image");
        expect(result).toBe("cropped:blob:local-generated-image");
    });

    it("revokes the temporary Blob URL when an image operation fails", async () => {
        const revokeObjectURL = vi.fn();

        await expect(
            withCanvasImageOperationSource(
                { url: "https://cdn.example/generated.png" },
                async () => {
                    throw new Error("canvas export failed");
                },
                {
                    resolveBlob: vi.fn(async () => new Blob(["generated"], { type: "image/png" })),
                    createObjectURL: vi.fn(() => "blob:temporary"),
                    revokeObjectURL,
                },
            ),
        ).rejects.toThrow("canvas export failed");

        expect(revokeObjectURL).toHaveBeenCalledWith("blob:temporary");
    });

    it("does not allocate an object URL when the source cannot be resolved", async () => {
        const createObjectURL = vi.fn();

        await expect(
            withCanvasImageOperationSource({ url: "https://cdn.example/expired.png" }, vi.fn(), {
                resolveBlob: vi.fn(async () => {
                    throw new Error("resource unavailable");
                }),
                createObjectURL,
                revokeObjectURL: vi.fn(),
            }),
        ).rejects.toThrow("resource unavailable");

        expect(createObjectURL).not.toHaveBeenCalled();
    });
});
