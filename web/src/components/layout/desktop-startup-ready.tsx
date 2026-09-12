import { useEffect } from "react";

import { invokeDesktop, isTauriRuntime, syncDesktopWindowTheme } from "@/services/platform/desktop-runtime";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";

let readyReported = false;

export function DesktopStartupReady() {
    const hydrated = useCanvasStore((state) => state.hydrated);

    useEffect(() => {
        if (!hydrated || readyReported || !isTauriRuntime()) return;
        readyReported = true;
        let firstFrame = 0;
        let secondFrame = 0;
        firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                void syncDesktopWindowTheme(useThemeStore.getState().theme)
                    .catch(() => undefined)
                    .then(() => invokeDesktop("frontend_ready"))
                    .catch(() => {
                        readyReported = false;
                    });
            });
        });
        return () => {
            cancelAnimationFrame(firstFrame);
            cancelAnimationFrame(secondFrame);
        };
    }, [hydrated]);

    return null;
}
