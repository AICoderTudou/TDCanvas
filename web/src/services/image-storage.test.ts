import { describe, expect, it, vi } from "vitest";

const readDesktopFileBlob = vi.hoisted(() => vi.fn());

vi.mock("@/services/platform/desktop-runtime", () => ({ readDesktopFileBlob }));

vi.hoisted(() => {
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    });
});

import { imageDataUrlToBlob, imageToDataUrl } from "./image-storage";

describe("image storage data URL conversion", () => {
    it("decodes Canvas base64 output locally without fetch", async () => {
        const blob = imageDataUrlToBlob("data:image/png;base64,aGVsbG8=");

        expect(blob.type).toBe("image/png");
        expect(blob.size).toBe(5);
        expect(await blob.text()).toBe("hello");
    });

    it("supports URL-encoded data and rejects malformed values", async () => {
        const blob = imageDataUrlToBlob("data:image/svg+xml,%3Csvg%3Eok%3C%2Fsvg%3E");
        expect(blob.type).toBe("image/svg+xml");
        expect(await blob.text()).toBe("<svg>ok</svg>");
        expect(() => imageDataUrlToBlob("not-a-data-url")).toThrow();
    });

    it("prefers a durable desktop cache over an expired provider URL", async () => {
        class TestFileReader {
            result: string | ArrayBuffer | null = "data:image/png;base64,Y2FjaGVkLWltYWdl";
            onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
            onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
            readAsDataURL() {
                this.onload?.({} as ProgressEvent<FileReader>);
            }
        }
        vi.stubGlobal("FileReader", TestFileReader);
        readDesktopFileBlob.mockResolvedValueOnce(new Blob(["cached-image"], { type: "image/png" }));
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const dataUrl = await imageToDataUrl({ dataUrl: "https://temporary.example/expired.png", localPath: "C:\\TDCanvas\\media-cache\\reference.png" });

        expect(dataUrl).toBe("data:image/png;base64,Y2FjaGVkLWltYWdl");
        expect(readDesktopFileBlob).toHaveBeenCalledWith("C:\\TDCanvas\\media-cache\\reference.png");
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
        vi.unstubAllGlobals();
    });
});
