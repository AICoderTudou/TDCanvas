import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import { normalizeDownloadFilename, resolveDownloadBlob } from "@/services/media-download";
import { saveBlobToDownloads } from "@/services/platform/desktop-runtime";
import { captureDownloadFeedback, emitDownloadComplete } from "@/services/download-feedback";
import type { Asset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "tdcanvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], filename: string) {
    const feedback = captureDownloadFeedback("file", filename);
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    await Promise.all(
        assets.map(async (asset) => {
            if (asset.kind !== "image" && asset.kind !== "video") return;
            const storageKey = asset.data.storageKey;
            if (!storageKey) return;
            const blob = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
            if (!blob) return;
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type, asset.kind)}`;
            files.push({ storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
        }),
    );

    const data: AssetExportFile = { app: "tdcanvas", version: 1, exportedAt: new Date().toISOString(), assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    const resolvedFilename = normalizeDownloadFilename(filename, "application/zip");
    await saveDownloadBlob(zip, resolvedFilename);
    emitDownloadComplete({ ...feedback, filename: resolvedFilename });
}

type BatchDownloadDependencies = {
    resolveBlobImpl: typeof resolveDownloadBlob;
    saveImpl: (blob: Blob, filename: string) => void | Promise<void>;
};

const batchDownloadDependencies: BatchDownloadDependencies = {
    resolveBlobImpl: resolveDownloadBlob,
    saveImpl: saveDownloadBlob,
};

export async function downloadAssetsZip(assets: Asset[], canvasTitle: string, dependencies: Partial<BatchDownloadDependencies> = {}) {
    const feedback = captureDownloadFeedback("file", `${canvasTitle}.zip`);
    const deps = { ...batchDownloadDependencies, ...dependencies };
    const zipFiles: Array<{ name: string; data: BlobPart }> = [];
    const usedNames = new Set<string>();
    let skipped = 0;

    for (const asset of assets) {
        try {
            if (asset.kind === "text") {
                zipFiles.push({ name: uniqueZipName(normalizeDownloadFilename(asset.title, "text/plain"), usedNames), data: asset.data.content });
                continue;
            }
            const mimeType = asset.data.mimeType || (asset.kind === "image" ? "image/png" : "video/mp4");
            const url = asset.kind === "image" ? asset.data.dataUrl || asset.coverUrl : asset.data.url;
            const blob = await deps.resolveBlobImpl({ kind: asset.kind, url, storageKey: asset.data.storageKey, filename: asset.title, mimeType });
            zipFiles.push({ name: uniqueZipName(normalizeDownloadFilename(asset.title, blob.type || mimeType), usedNames), data: blob });
        } catch {
            skipped += 1;
        }
    }

    if (!zipFiles.length) throw new Error("没有可下载的本地素材");
    const filename = normalizeDownloadFilename(`${canvasTitle.trim() || "TDCanvas"}.zip`, "application/zip");
    const zip = await createZip(zipFiles);
    await deps.saveImpl(zip, filename);
    emitDownloadComplete({ ...feedback, filename });
    return { filename, downloaded: zipFiles.length, skipped };
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    await Promise.all(
        data.files.map(async (item) => {
            const blob = zip.get(item.path);
            if (!blob) return;
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
            await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
        }),
    );
    return data.assets;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

async function saveDownloadBlob(blob: Blob, filename: string) {
    if (await saveBlobToDownloads(blob, filename)) return;
    saveAs(blob, filename);
}

function uniqueZipName(filename: string, usedNames: Set<string>) {
    const key = filename.toLowerCase();
    if (!usedNames.has(key)) {
        usedNames.add(key);
        return filename;
    }
    const dot = filename.lastIndexOf(".");
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : "";
    for (let index = 2; ; index += 1) {
        const candidate = `${base} (${index})${extension}`;
        const candidateKey = candidate.toLowerCase();
        if (!usedNames.has(candidateKey)) {
            usedNames.add(candidateKey);
            return candidate;
        }
    }
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}
