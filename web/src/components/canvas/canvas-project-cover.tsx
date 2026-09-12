import { useEffect, useMemo, useState } from "react";

import { latestGeneratedCanvasMedia } from "@/lib/canvas/canvas-home";
import { localMediaCacheUrl } from "@/services/local-media-cache";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

import { CanvasProjectPreview } from "./canvas-project-preview";

export function CanvasProjectCover({ project }: { project: CanvasProject }) {
    const media = useMemo(() => latestGeneratedCanvasMedia(project), [project]);
    const fallbackUrl = useMemo(() => {
        if (!media) return "";
        return media.localPath ? localMediaCacheUrl(media.localPath, media.filename) || media.url : media.url;
    }, [media]);
    const [url, setUrl] = useState(fallbackUrl);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let disposed = false;
        setUrl(fallbackUrl);
        setFailed(false);
        if (!media?.storageKey) return;
        const resolve = media.kind === "image" ? resolveImageUrl : resolveMediaUrl;
        void resolve(media.storageKey, fallbackUrl).then((resolvedUrl) => {
            if (!disposed && resolvedUrl) setUrl(resolvedUrl);
        });
        return () => {
            disposed = true;
        };
    }, [fallbackUrl, media?.kind, media?.storageKey]);

    if (!media || !url || failed) return <CanvasProjectPreview project={project} />;

    if (media.kind === "video") {
        return (
            <video
                data-canvas-project-cover="video"
                src={url}
                muted
                playsInline
                preload="metadata"
                className="absolute inset-0 size-full object-cover"
                onLoadedData={(event) => {
                    const video = event.currentTarget;
                    if (Number.isFinite(video.duration) && video.duration > 0.12) video.currentTime = 0.12;
                }}
                onError={() => setFailed(true)}
            />
        );
    }

    return <img data-canvas-project-cover="image" src={url} alt="" draggable={false} className="absolute inset-0 size-full select-none object-cover" onError={() => setFailed(true)} />;
}
