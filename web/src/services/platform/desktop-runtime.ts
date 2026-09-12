import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { BaseDirectory, join } from "@tauri-apps/api/path";
import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";
import { exists, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export function isTauriRuntime() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isWindowsDesktopRuntime() {
    return isTauriRuntime() && /Windows NT/i.test(navigator.userAgent);
}

export function getDesktopWindow() {
    return isTauriRuntime() ? getCurrentWindow() : null;
}

export const platformFetch: typeof fetch = async (input, init) => {
    if (!isTauriRuntime()) return globalThis.fetch(input, init);
    return tauriFetch(input as string | URL | Request, init) as Promise<Response>;
};

export async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
    if (!isTauriRuntime()) throw new Error("当前不是 TDCanvas 桌面客户端");
    return invoke<T>(command, args);
}

export function desktopFileUrl(absolutePath: string) {
    return isTauriRuntime() && absolutePath ? convertFileSrc(absolutePath) : "";
}

export function isDesktopAssetUrl(value: string | undefined) {
    return Boolean(value && (/^asset:\/\//i.test(value) || /^https?:\/\/asset\.localhost(?:\/|$)/i.test(value)));
}

export async function readDesktopFileBlob(absolutePath: string, mimeType?: string) {
    if (!isTauriRuntime() || !absolutePath) return null;
    const bytes = await readFile(absolutePath);
    if (!bytes.byteLength) throw new Error("本地缓存文件为空");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Blob([buffer], { type: mimeType || "application/octet-stream" });
}

export async function syncDesktopWindowTheme(theme: Theme) {
    await getDesktopWindow()?.setTheme(theme);
}

export async function saveBlobToDownloads(blob: Blob, filename: string) {
    if (!isTauriRuntime()) return false;
    let directory = readCustomDownloadDirectory();
    if (directory) {
        try {
            directory = await invokeDesktop<string>("allow_download_directory", { directory });
        } catch {
            clearCustomDownloadDirectory();
            directory = "";
        }
    }
    const target = await availableDownloadName(filename, directory);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (directory) await writeFile(target, bytes);
    else await writeFile(target, bytes, { baseDir: BaseDirectory.Download });
    return target;
}

export const CUSTOM_DOWNLOAD_DIRECTORY_STORAGE_KEY = "tdcanvas:download-directory";

export function readCustomDownloadDirectory() {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(CUSTOM_DOWNLOAD_DIRECTORY_STORAGE_KEY)?.trim() || "";
}

export function setCustomDownloadDirectory(directory: string) {
    const value = directory.trim();
    if (typeof window === "undefined" || !value) return;
    window.localStorage.setItem(CUSTOM_DOWNLOAD_DIRECTORY_STORAGE_KEY, value);
}

export function clearCustomDownloadDirectory() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(CUSTOM_DOWNLOAD_DIRECTORY_STORAGE_KEY);
}

async function availableDownloadName(filename: string, directory = "") {
    const targetFor = async (candidate: string) => (directory ? join(directory, candidate) : candidate);
    const firstTarget = await targetFor(filename);
    if (!(await exists(firstTarget, directory ? undefined : { baseDir: BaseDirectory.Download }))) return firstTarget;
    const dot = filename.lastIndexOf(".");
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : "";
    for (let index = 1; index < 10_000; index += 1) {
        const candidate = `${base} (${index})${extension}`;
        const target = await targetFor(candidate);
        if (!(await exists(target, directory ? undefined : { baseDir: BaseDirectory.Download }))) return target;
    }
    return targetFor(`${base}-${Date.now()}${extension}`);
}
