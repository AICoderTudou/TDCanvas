import type { DownloadableMediaKind } from "@/services/media-download";

export const DOWNLOAD_COMPLETE_EVENT = "tdcanvas:download-complete";

export type DownloadFeedbackDetail = {
    id: string;
    kind: DownloadableMediaKind;
    filename?: string;
    previewUrl?: string;
    origin: { x: number; y: number };
};

export function captureDownloadFeedback(kind: DownloadableMediaKind, filename?: string, previewUrl?: string): DownloadFeedbackDetail {
    const origin = activeDownloadOrigin();
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        filename,
        previewUrl: kind === "image" ? previewUrl : undefined,
        origin,
    };
}

export function emitDownloadComplete(detail: DownloadFeedbackDetail) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<DownloadFeedbackDetail>(DOWNLOAD_COMPLETE_EVENT, { detail }));
}

function activeDownloadOrigin() {
    if (typeof document === "undefined" || typeof window === "undefined") return { x: 0, y: 0 };
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
        const rect = activeElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: window.innerWidth / 2, y: Math.max(80, window.innerHeight * 0.62) };
}
