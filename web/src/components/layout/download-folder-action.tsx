import { open } from "@tauri-apps/plugin-dialog";
import { App, Dropdown, Tooltip } from "antd";
import { File, FileAudio, FileImage, FileVideo, FolderCog, FolderOpen, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { DOWNLOAD_COMPLETE_EVENT, type DownloadFeedbackDetail } from "@/services/download-feedback";
import { clearCustomDownloadDirectory, invokeDesktop, isTauriRuntime, readCustomDownloadDirectory, setCustomDownloadDirectory } from "@/services/platform/desktop-runtime";

type DownloadFlight = DownloadFeedbackDetail & {
    target: { x: number; y: number };
    midpoint: { x: number; y: number };
};

export function DownloadFolderAction({ className, style }: { className: string; style?: CSSProperties }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [flights, setFlights] = useState<DownloadFlight[]>([]);
    const [landing, setLanding] = useState(false);
    const [customDirectory, setCustomDirectoryState] = useState(readCustomDownloadDirectory);

    useEffect(() => {
        const onDownloadComplete = (event: Event) => {
            const detail = (event as CustomEvent<DownloadFeedbackDetail>).detail;
            const targetRect = buttonRef.current?.getBoundingClientRect();
            if (!detail || !targetRect) return;
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                setLanding(true);
                return;
            }
            const target = { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 };
            const midpoint = {
                x: detail.origin.x + (target.x - detail.origin.x) * 0.56,
                y: Math.max(10, Math.min(detail.origin.y, target.y) - Math.min(92, Math.abs(detail.origin.x - target.x) * 0.12 + 36)),
            };
            setFlights((current) => [...current.slice(-3), { ...detail, target, midpoint }]);
        };
        window.addEventListener(DOWNLOAD_COMPLETE_EVENT, onDownloadComplete);
        return () => window.removeEventListener(DOWNLOAD_COMPLETE_EVENT, onDownloadComplete);
    }, []);

    if (!isTauriRuntime()) return null;

    const openDownloads = async () => {
        try {
            await invokeDesktop("open_downloads_directory", { directory: customDirectory || null });
        } catch (error) {
            message.error(t("topNav.openDownloadsFailed", { message: error instanceof Error ? error.message : String(error) }));
        }
    };

    const chooseDirectory = async () => {
        try {
            const selected = await open({ directory: true, multiple: false, title: t("topNav.chooseDownloadDirectory") });
            if (!selected || Array.isArray(selected)) return;
            const directory = await invokeDesktop<string>("allow_download_directory", { directory: selected });
            setCustomDownloadDirectory(directory);
            setCustomDirectoryState(directory);
            message.success(t("topNav.downloadDirectoryChanged"));
        } catch (error) {
            message.error(t("topNav.changeDownloadDirectoryFailed", { message: error instanceof Error ? error.message : String(error) }));
        }
    };

    const resetDirectory = () => {
        clearCustomDownloadDirectory();
        setCustomDirectoryState("");
        message.success(t("topNav.downloadDirectoryReset"));
    };

    const menuItems = [
        {
            key: "current",
            disabled: true,
            label: (
                <span className="block max-w-72">
                    <span className="block text-[10px] uppercase tracking-[0.12em] opacity-45">{t("topNav.currentDownloadDirectory")}</span>
                    <span className="mt-0.5 block truncate text-xs" title={customDirectory || t("topNav.systemDownloadDirectory")}>{customDirectory || t("topNav.systemDownloadDirectory")}</span>
                </span>
            ),
        },
        { type: "divider" as const },
        { key: "open", icon: <FolderOpen className="size-4" />, label: t("topNav.openDownloads"), onClick: () => void openDownloads() },
        { key: "change", icon: <FolderCog className="size-4" />, label: t("topNav.changeDownloadDirectory"), onClick: () => void chooseDirectory() },
        ...(customDirectory ? [{ key: "reset", icon: <RotateCcw className="size-4" />, label: t("topNav.resetDownloadDirectory"), onClick: resetDirectory }] : []),
    ];

    return (
        <>
            <Dropdown trigger={["contextMenu"]} menu={{ items: menuItems }}>
                <span className="inline-flex">
                    <Tooltip title={t("topNav.downloadFolderHint")} mouseEnterDelay={0.2}>
                        <button
                            ref={buttonRef}
                            type="button"
                            data-custom-directory={Boolean(customDirectory)}
                            className={`${className} td-download-folder-action ${landing ? "is-landing" : ""}`}
                            style={style}
                            onClick={() => void openDownloads()}
                            onAnimationEnd={() => setLanding(false)}
                            aria-label={t("topNav.openDownloads")}
                        >
                            <FolderOpen className="size-4" />
                            {customDirectory ? <span className="td-download-folder-custom-dot" /> : null}
                        </button>
                    </Tooltip>
                </span>
            </Dropdown>
            {typeof document !== "undefined"
                ? createPortal(
                      flights.map((flight) => (
                          <DownloadFlightItem
                              key={flight.id}
                              flight={flight}
                              onComplete={() => {
                                  setFlights((current) => current.filter((item) => item.id !== flight.id));
                                  setLanding(true);
                              }}
                          />
                      )),
                      document.body,
                  )
                : null}
        </>
    );
}

function DownloadFlightItem({ flight, onComplete }: { flight: DownloadFlight; onComplete: () => void }) {
    const style = {
        "--td-download-from-x": `${flight.origin.x - 18}px`,
        "--td-download-from-y": `${flight.origin.y - 20}px`,
        "--td-download-mid-x": `${flight.midpoint.x - 18}px`,
        "--td-download-mid-y": `${flight.midpoint.y - 20}px`,
        "--td-download-to-x": `${flight.target.x - 18}px`,
        "--td-download-to-y": `${flight.target.y - 20}px`,
    } as CSSProperties;
    const Icon = flight.kind === "image" ? FileImage : flight.kind === "video" ? FileVideo : flight.kind === "audio" ? FileAudio : File;
    return (
        <span className="td-download-flight" style={style} onAnimationEnd={onComplete} aria-hidden="true">
            {flight.previewUrl ? <img src={flight.previewUrl} alt="" /> : <Icon className="size-[18px]" strokeWidth={1.7} />}
            <span className="td-download-flight-fold" />
        </span>
    );
}
