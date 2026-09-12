import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";
import { useTranslation } from "react-i18next";
import { APP_VERSION, CHANGELOG_URL, DESKTOP_UPDATER_ENABLED, VERSION_URL } from "@/constant/env";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";

export type DesktopUpdateStatus = "idle" | "available" | "downloading" | "ready" | "installing" | "error";

function readLocalReleases(): ReleaseInfo[] {
    return __APP_RELEASES__ || [];
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

function describeError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function useVersionCheck() {
    const { t } = useTranslation();
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const pendingUpdateRef = useRef<Update | null>(null);
    const desktopUpdaterEnabled = DESKTOP_UPDATER_ENABLED && isTauri();
    const releaseInfoEnabled = Boolean(VERSION_URL && CHANGELOG_URL);
    const canCheckUpdates = desktopUpdaterEnabled || releaseInfoEnabled;
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus>("idle");
    const [downloadedBytes, setDownloadedBytes] = useState(0);
    const [totalBytes, setTotalBytes] = useState<number | null>(null);
    const [updateError, setUpdateError] = useState("");
    const [updateNotes, setUpdateNotes] = useState("");
    const hasNativeUpdate = ["available", "downloading", "ready", "installing"].includes(updateStatus);
    const hasNewVersion = hasNativeUpdate || isNewerVersion(latestVersion, currentVersion);
    const downloadProgress = totalBytes && totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;

    const loadReleaseNotes = useCallback(async () => {
        if (!CHANGELOG_URL) return;
        const response = await fetch(CHANGELOG_URL);
        if (!response.ok) throw new Error(t("version.changelogFailed"));
        const changelog = await response.text();
        if (changelog.trim()) setReleases(parseChangelog(changelog));
    }, [t]);

    const checkDesktopUpdate = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            setUpdateError("");
            try {
                const { check } = await import("@tauri-apps/plugin-updater");
                const update = await check({ timeout: 30_000 });
                const previous = pendingUpdateRef.current;
                pendingUpdateRef.current = update;
                if (previous && previous !== update) void previous.close().catch(() => undefined);

                if (update) {
                    setLatestVersion(update.version);
                    setUpdateNotes(update.body?.trim() || "");
                    setUpdateStatus("available");
                    setDownloadedBytes(0);
                    setTotalBytes(null);
                    if (showMessage) message.success(t("version.availableMessage", { version: update.version }));
                } else {
                    setLatestVersion(currentVersion);
                    setUpdateNotes("");
                    setUpdateStatus("idle");
                    if (showMessage) message.success(t("version.alreadyLatest"));
                }
                await loadReleaseNotes().catch(() => undefined);
                return true;
            } catch (error) {
                setUpdateStatus("error");
                setUpdateError(describeError(error));
                if (showMessage) message.error(t("version.updateFailed"));
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, loadReleaseNotes, message, t],
    );

    const checkReleaseInformation = useCallback(
        async (showMessage = false) => {
            if (!releaseInfoEnabled) {
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                return false;
            }
            setChecking(true);
            try {
                const [versionResponse, changelogResponse] = await Promise.all([fetch(VERSION_URL), fetch(CHANGELOG_URL)]);
                if (!versionResponse.ok) throw new Error(t("version.readFailed"));
                if (!changelogResponse.ok) throw new Error(t("version.changelogFailed"));
                const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
                setLatestVersion(version.trim() || currentVersion);
                if (changelog.trim()) setReleases(parseChangelog(changelog));
                if (showMessage) message.success(t("version.updated"));
                return true;
            } catch {
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                if (showMessage) message.error(t("version.updateFailed"));
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases, message, releaseInfoEnabled, t],
    );

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            if (desktopUpdaterEnabled) return checkDesktopUpdate(showMessage);
            return checkReleaseInformation(showMessage);
        },
        [checkDesktopUpdate, checkReleaseInformation, desktopUpdaterEnabled],
    );

    const downloadUpdate = useCallback(async () => {
        const update = pendingUpdateRef.current;
        if (!update) return false;
        setUpdateStatus("downloading");
        setDownloadedBytes(0);
        setTotalBytes(null);
        setUpdateError("");
        try {
            await update.download((event) => {
                if (event.event === "Started") {
                    setTotalBytes(event.data.contentLength ?? null);
                    return;
                }
                if (event.event === "Progress") {
                    setDownloadedBytes((value) => value + event.data.chunkLength);
                    return;
                }
                setUpdateStatus("ready");
            });
            setUpdateStatus("ready");
            return true;
        } catch (error) {
            setUpdateStatus("error");
            setUpdateError(describeError(error));
            message.error(t("version.downloadFailed"));
            return false;
        }
    }, [message, t]);

    const restartAndInstall = useCallback(async () => {
        const update = pendingUpdateRef.current;
        if (!update) return false;
        setUpdateStatus("installing");
        setUpdateError("");
        try {
            await update.install({ restartAfterInstall: true });
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
            return true;
        } catch (error) {
            setUpdateStatus("error");
            setUpdateError(describeError(error));
            message.error(t("version.installFailed"));
            return false;
        }
    }, [message, t]);

    useEffect(() => {
        if (desktopUpdaterEnabled) {
            void checkDesktopUpdate(false);
            return;
        }
        if (!VERSION_URL) return;
        void checkReleaseInformation(false);
    }, [checkDesktopUpdate, checkReleaseInformation, desktopUpdaterEnabled]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        const updateInProgress = ["downloading", "ready", "installing"].includes(updateStatus);
        if (canCheckUpdates && !checking && !updateInProgress) void checkLatestRelease(false);
    }, [canCheckUpdates, checkLatestRelease, checking, updateStatus]);

    return {
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
    };
}
