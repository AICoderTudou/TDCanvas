import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getDesktopWindow, isWindowsDesktopRuntime } from "@/services/platform/desktop-runtime";

export function DesktopTitlebar() {
    const { t } = useTranslation();
    const enabled = isWindowsDesktopRuntime();
    const [maximized, setMaximized] = useState(false);
    const [focused, setFocused] = useState(true);

    const refreshMaximized = useCallback(async () => {
        const appWindow = getDesktopWindow();
        if (appWindow) setMaximized(await appWindow.isMaximized());
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const appWindow = getDesktopWindow();
        if (!appWindow) return;
        let disposed = false;
        let unlistenResize: (() => void) | undefined;
        let unlistenFocus: (() => void) | undefined;
        void refreshMaximized().catch(() => undefined);
        void appWindow.isFocused().then(setFocused).catch(() => undefined);
        void appWindow
            .onResized(() => void refreshMaximized().catch(() => undefined))
            .then((stop) => {
                if (disposed) stop();
                else unlistenResize = stop;
            })
            .catch(() => undefined);
        void appWindow
            .onFocusChanged(({ payload }) => setFocused(payload))
            .then((stop) => {
                if (disposed) stop();
                else unlistenFocus = stop;
            })
            .catch(() => undefined);
        return () => {
            disposed = true;
            unlistenResize?.();
            unlistenFocus?.();
        };
    }, [enabled, refreshMaximized]);

    if (!enabled) return null;

    const minimize = () => void getDesktopWindow()?.minimize().catch(() => undefined);
    const close = () => void getDesktopWindow()?.close().catch(() => undefined);
    const toggleMaximize = () => {
        const appWindow = getDesktopWindow();
        if (!appWindow) return;
        void appWindow
            .toggleMaximize()
            .then(refreshMaximized)
            .catch(() => undefined);
    };

    return (
        <header
            data-tauri-drag-region
            data-window-focused={focused}
            className="td-desktop-titlebar relative z-[1200] flex h-12 shrink-0 select-none items-center bg-[#f4f2ed] text-[#78716c] dark:bg-[#090a0c] dark:text-[#8b8f94]"
        >
            <div data-tauri-drag-region className="td-desktop-titlebar-brand flex h-full shrink-0 items-center gap-2 pl-4 pr-5">
                <span
                    aria-hidden="true"
                    className="pointer-events-none size-[18px] shrink-0 bg-current opacity-90"
                    style={{
                        mask: "url(/logo.svg) center / contain no-repeat",
                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                    }}
                />
                <span className="pointer-events-none text-[13px] font-semibold tracking-[-0.01em] text-[#292524] dark:text-[#f4f4f5]">TDCanvas</span>
            </div>

            <div id="td-desktop-titlebar-navigation-slot" className="td-desktop-titlebar-slot flex h-full min-w-0 shrink items-stretch" />

            <div data-tauri-drag-region className="h-full min-w-8 flex-1" aria-hidden="true" />

            <div id="td-desktop-titlebar-actions-slot" className="td-desktop-titlebar-slot flex h-full shrink-0 items-center px-2" />

            <div className="flex h-full shrink-0 items-stretch">
                <button
                    type="button"
                    className="td-desktop-window-button flex w-11 items-center justify-center hover:bg-black/[0.06] hover:text-[#292524] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#047857] active:bg-black/[0.10] dark:hover:bg-white/[0.07] dark:hover:text-[#f4f4f5] dark:focus-visible:outline-[#5ee6b9] dark:active:bg-white/[0.12]"
                    onClick={minimize}
                    aria-label={t("desktopWindow.minimize")}
                    title={t("desktopWindow.minimize")}
                >
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none size-3.5" fill="none">
                        <path d="M3 11.5h10" stroke="currentColor" strokeWidth="1.15" />
                    </svg>
                </button>
                <button
                    type="button"
                    className="td-desktop-window-button flex w-11 items-center justify-center hover:bg-black/[0.06] hover:text-[#292524] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#047857] active:bg-black/[0.10] dark:hover:bg-white/[0.07] dark:hover:text-[#f4f4f5] dark:focus-visible:outline-[#5ee6b9] dark:active:bg-white/[0.12]"
                    onClick={toggleMaximize}
                    aria-label={t(maximized ? "desktopWindow.restore" : "desktopWindow.maximize")}
                    title={t(maximized ? "desktopWindow.restore" : "desktopWindow.maximize")}
                >
                    {maximized ? (
                        <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none size-3.5" fill="none">
                            <path d="M5.25 5V3.75h7v7H11" stroke="currentColor" strokeWidth="1.05" />
                            <rect x="3.75" y="5.75" width="6.5" height="6.5" stroke="currentColor" strokeWidth="1.05" />
                        </svg>
                    ) : (
                        <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none size-3.5" fill="none">
                            <rect x="3.75" y="3.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.05" />
                        </svg>
                    )}
                </button>
                <button
                    type="button"
                    className="td-desktop-window-button flex w-11 items-center justify-center hover:bg-[#c42b1c] hover:text-white focus-visible:bg-[#c42b1c] focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white active:bg-[#a82116]"
                    onClick={close}
                    aria-label={t("desktopWindow.close")}
                    title={t("desktopWindow.close")}
                >
                    <X aria-hidden="true" className="pointer-events-none size-[15px]" strokeWidth={1.35} />
                </button>
            </div>
        </header>
    );
}
