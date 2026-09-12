import type { CSSProperties } from "react";
import { Alert, Button, Modal, Progress, Tag, Timeline } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useVersionCheck } from "@/hooks/use-version-check";
import { APP_VERSION } from "@/constant/env";

function getTagColor(type: string) {
    if (type === "新增" || type === "Added") return "green";
    if (type === "修复" || type === "Fixed") return "red";
    if (type === "调整" || type === "Changed") return "blue";
    if (type === "文档" || type === "Docs") return "purple";
    return "default";
}

function releaseTypeLabel(type: string, t: TFunction) {
    const key = ({ 新增: "added", 修复: "fixed", 调整: "changed", 优化: "optimized", 文档: "docs" } as Record<string, string>)[type];
    return key ? t(`version.types.${key}`) : type;
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** index;
    return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { t } = useTranslation();
    const {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        canCheckUpdates,
        hasNewVersion,
        checkLatestRelease,
        desktopUpdaterEnabled,
        updateStatus,
        updateError,
        updateNotes,
        downloadProgress,
        downloadedBytes,
        totalBytes,
        downloadUpdate,
        restartAndInstall,
    } = useVersionCheck();

    return (
        <>
            <button
                type="button"
                className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                style={style}
                onClick={openReleaseModal}
                title={t("version.viewUpdates")}
            >
                <span className="relative inline-flex">
                    {APP_VERSION}
                    {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                </span>
            </button>
            <Modal title={t("version.title")} open={open} width={680} centered footer={null} onCancel={() => setOpen(false)}>
                <div className={`mb-5 grid gap-3 ${canCheckUpdates ? "grid-cols-2" : "grid-cols-1"}`}>
                    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="text-xs text-stone-500 dark:text-stone-400">{t("version.currentVersion")}</div>
                        <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{APP_VERSION}</div>
                    </div>
                    {canCheckUpdates ? (
                        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-stone-500 dark:text-stone-400">{t("version.latestVersion")}</div>
                                <button
                                    type="button"
                                    className="cursor-pointer bg-transparent p-0 text-[11px] font-normal text-stone-400 underline-offset-2 transition hover:text-stone-700 hover:underline dark:text-stone-500 dark:hover:text-stone-300"
                                    onClick={() => void checkLatestRelease(true)}
                                >
                                    {t(checking ? "version.checking" : "version.checkUpdates")}
                                </button>
                            </div>
                            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{latestVersion}</div>
                        </div>
                    ) : null}
                </div>
                {desktopUpdaterEnabled ? (
                    <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50/80 p-4 dark:border-stone-800 dark:bg-stone-900/70">
                        {updateStatus === "error" ? (
                            <Alert
                                type="error"
                                showIcon
                                message={t("version.updateErrorTitle")}
                                description={updateError || t("version.updateFailed")}
                                action={
                                    <Button size="small" onClick={() => void checkLatestRelease(false)} loading={checking}>
                                        {t("version.retry")}
                                    </Button>
                                }
                            />
                        ) : updateStatus === "downloading" ? (
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-4">
                                    <div>
                                        <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t("version.downloading")}</div>
                                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                                            {totalBytes ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}` : formatBytes(downloadedBytes)}
                                        </div>
                                    </div>
                                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{downloadProgress === null ? "…" : `${downloadProgress}%`}</span>
                                </div>
                                <Progress percent={downloadProgress ?? 0} showInfo={false} status="active" strokeColor="#3b82f6" />
                            </div>
                        ) : updateStatus === "ready" ? (
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t("version.downloadReady")}</div>
                                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("version.restartHint")}</div>
                                </div>
                                <Button type="primary" icon={<ReloadOutlined />} onClick={() => void restartAndInstall()}>
                                    {t("version.restartAndUpdate")}
                                </Button>
                            </div>
                        ) : updateStatus === "installing" ? (
                            <div className="flex items-center gap-3">
                                <ReloadOutlined spin className="text-blue-500" />
                                <div>
                                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t("version.installing")}</div>
                                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("version.installingHint")}</div>
                                </div>
                            </div>
                        ) : updateStatus === "available" ? (
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t("version.available", { version: latestVersion })}</div>
                                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("version.downloadHint")}</div>
                                </div>
                                <Button type="primary" icon={<DownloadOutlined />} onClick={() => void downloadUpdate()}>
                                    {t("version.downloadUpdate")}
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t(checking ? "version.checking" : "version.alreadyLatest")}</div>
                                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("version.automaticCheckHint")}</div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}
                {desktopUpdaterEnabled && updateNotes ? (
                    <div className="mb-5 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                        <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-stone-500 dark:text-stone-400">{t("version.releaseNotes")}</div>
                        <div className="whitespace-pre-wrap text-sm leading-6 text-stone-700 dark:text-stone-300">{updateNotes}</div>
                    </div>
                ) : null}
                <div className="max-h-[56vh] overflow-y-auto pr-2">
                    <Timeline
                        items={releases.map((release) => ({
                            content: (
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{release.version === "Unreleased" ? t("version.unreleased") : release.version}</span>
                                        <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {release.version === latestVersion ? <Tag color="green">{t("version.latest")}</Tag> : null}
                                            {release.version === APP_VERSION ? <Tag>{t("version.current")}</Tag> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 space-y-1.5">
                                        {release.items.map((item, index) => (
                                            <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                                    {releaseTypeLabel(item.type, t)}
                                                </Tag>
                                                <span className="min-w-0 flex-1">{item.content}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ),
                        }))}
                    />
                </div>
            </Modal>
        </>
    );
}
