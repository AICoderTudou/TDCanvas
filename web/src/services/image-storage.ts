import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { readImageMeta } from "@/lib/image-utils";
import { readDesktopFileBlob } from "@/services/platform/desktop-runtime";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "tdcanvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? (input.startsWith("data:") ? imageDataUrlToBlob(input) : await (await fetch(input)).blob()) : input;
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string; localPath?: string }) {
    if (image.dataUrl?.startsWith("data:")) return image.dataUrl;
    let storedBlob: Blob | null = null;
    try {
        storedBlob = image.storageKey ? await getImageBlob(image.storageKey) : null;
    } catch {
        storedBlob = null;
    }
    if (storedBlob) return blobToDataUrl(storedBlob);
    let diskBlob: Blob | null = null;
    try {
        diskBlob = image.localPath ? await readDesktopFileBlob(image.localPath) : null;
    } catch {
        diskBlob = null;
    }
    if (diskBlob) return blobToDataUrl(diskBlob);
    const url = image.dataUrl || image.url || "";
    if (!url) return "";
    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 404 || response.status === 410) throw new Error("引用图片的原地址已失效，且未找到可用的本地副本。请重新上传该素材后再生成。");
        throw new Error(i18n.t("common.imageReadFailed"));
    }
    return blobToDataUrl(await response.blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await Promise.all(
        unused.map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export function imageDataUrlToBlob(dataUrl: string) {
    const separator = dataUrl.indexOf(",");
    if (separator < 0 || !dataUrl.startsWith("data:")) throw new Error(i18n.t("common.imageReadFailed"));
    const header = dataUrl.slice(5, separator);
    const payload = dataUrl.slice(separator + 1);
    const mimeType = header.split(";", 1)[0] || "image/png";
    try {
        if (/;base64(?:;|$)/i.test(header)) {
            const binary = atob(payload);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            return new Blob([bytes], { type: mimeType });
        }
        return new Blob([decodeURIComponent(payload)], { type: mimeType });
    } catch {
        throw new Error(i18n.t("common.imageReadFailed"));
    }
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
