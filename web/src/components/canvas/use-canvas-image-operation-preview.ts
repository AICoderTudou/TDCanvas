import { useEffect, useState } from "react";

import { resolveCanvasImageOperationBlob, type CanvasImageOperationSource } from "@/lib/canvas/canvas-image-operation-source";

type PreviewState = {
    url: string;
    loading: boolean;
    error: string;
};

const emptyState: PreviewState = { url: "", loading: false, error: "" };

/** Resolves editor previews through the exact same local-first path as export. */
export function useCanvasImageOperationPreview(source: CanvasImageOperationSource | null, enabled: boolean) {
    const [state, setState] = useState<PreviewState>(emptyState);

    useEffect(() => {
        if (!enabled || !source?.url) {
            setState(emptyState);
            return;
        }

        let disposed = false;
        let objectUrl = "";
        setState({ url: "", loading: true, error: "" });
        void resolveCanvasImageOperationBlob(source)
            .then((blob) => {
                if (disposed) return;
                objectUrl = URL.createObjectURL(blob);
                setState({ url: objectUrl, loading: false, error: "" });
            })
            .catch((error) => {
                if (disposed) return;
                setState({ url: "", loading: false, error: error instanceof Error ? error.message : String(error) });
            });

        return () => {
            disposed = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [enabled, source?.filename, source?.localPath, source?.mimeType, source?.sourceUrl, source?.storageKey, source?.url]);

    return state;
}
