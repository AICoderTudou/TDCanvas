import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearCustomDownloadDirectory, CUSTOM_DOWNLOAD_DIRECTORY_STORAGE_KEY, readCustomDownloadDirectory, setCustomDownloadDirectory } from "./desktop-runtime";

describe("desktop custom download directory", () => {
    const values = new Map<string, string>();

    beforeEach(() => {
        values.clear();
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                localStorage: {
                    getItem: (key: string) => values.get(key) ?? null,
                    setItem: (key: string, value: string) => values.set(key, value),
                    removeItem: (key: string) => values.delete(key),
                },
            },
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, "window");
    });

    it("persists, trims, and resets the selected location", () => {
        setCustomDownloadDirectory("  D:\\TDCanvas Downloads  ");
        expect(values.get(CUSTOM_DOWNLOAD_DIRECTORY_STORAGE_KEY)).toBe("D:\\TDCanvas Downloads");
        expect(readCustomDownloadDirectory()).toBe("D:\\TDCanvas Downloads");

        clearCustomDownloadDirectory();
        expect(readCustomDownloadDirectory()).toBe("");
    });
});
