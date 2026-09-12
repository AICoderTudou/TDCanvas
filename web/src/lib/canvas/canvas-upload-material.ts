export type CanvasMaterialKind = "image" | "video" | "audio";

export const CANVAS_MATERIAL_MAX_BYTES = 50 * 1024 * 1024;

export const CANVAS_MATERIAL_ACCEPT_BY_KIND: Record<CanvasMaterialKind, string> = {
    image: ["image/jpeg", "image/png", "image/webp", ".jpg", ".jpeg", ".png", ".webp"].join(","),
    video: ["video/mp4", "video/quicktime", "video/x-msvideo", "video/x-matroska", ".mp4", ".mov", ".avi", ".mkv"].join(","),
    audio: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac", ".mp3", ".wav", ".flac"].join(","),
};

export const CANVAS_MATERIAL_ACCEPT = Object.values(CANVAS_MATERIAL_ACCEPT_BY_KIND).join(",");

const KIND_BY_MIME: Record<string, CanvasMaterialKind> = {
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "video/mp4": "video",
    "video/quicktime": "video",
    "video/x-msvideo": "video",
    "video/x-matroska": "video",
    "audio/mpeg": "audio",
    "audio/mp3": "audio",
    "audio/wav": "audio",
    "audio/x-wav": "audio",
    "audio/flac": "audio",
    "audio/x-flac": "audio",
};

const KIND_BY_EXTENSION: Record<string, CanvasMaterialKind> = {
    jpg: "image",
    jpeg: "image",
    png: "image",
    webp: "image",
    mp4: "video",
    mov: "video",
    avi: "video",
    mkv: "video",
    mp3: "audio",
    wav: "audio",
    flac: "audio",
};

export type CanvasMaterialValidation = { ok: true; kind: CanvasMaterialKind } | { ok: false; reason: "unsupported" | "too-large" };

export function validateCanvasMaterialFile(file: Pick<File, "name" | "type" | "size">): CanvasMaterialValidation {
    if (file.size > CANVAS_MATERIAL_MAX_BYTES) return { ok: false, reason: "too-large" };

    const mime = file.type.trim().toLowerCase();
    const mimeKind = KIND_BY_MIME[mime];
    if (mimeKind) return { ok: true, kind: mimeKind };

    // Some drag-and-drop sources omit MIME. Only then fall back to the documented extension list.
    if (!mime) {
        const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
        const extensionKind = extension ? KIND_BY_EXTENSION[extension] : undefined;
        if (extensionKind) return { ok: true, kind: extensionKind };
    }

    return { ok: false, reason: "unsupported" };
}
