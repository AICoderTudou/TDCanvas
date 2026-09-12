import { Popover, Tooltip } from "antd";
import { LoaderCircle, RefreshCw, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { runAitudouOperation, AITUDOU_OFFICIAL_BASE_URL } from "@/services/api/aitudou";
import { AITUDOU_WALLET_REFRESH_EVENT, formatAitudouWalletAmount, parseAitudouWalletSummary, type AitudouWalletSummary } from "@/services/api/aitudou-wallet";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type WalletStatus = "idle" | "loading" | "ready" | "error";

/** A compact balance indicator refreshed only on demand or after a completed task. */
export function CanvasWalletBalance() {
    const { t, i18n } = useTranslation();
    const apiKey = useConfigStore((state) => state.config.apiKey);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const [wallet, setWallet] = useState<AitudouWalletSummary | null>(null);
    const [status, setStatus] = useState<WalletStatus>("idle");
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

    const refresh = useCallback(async () => {
        const currentApiKey = apiKey.trim();
        if (!currentApiKey) {
            setWallet(null);
            setStatus("idle");
            setUpdatedAt(null);
            return;
        }

        setStatus("loading");
        try {
            const result = await runAitudouOperation({ apiKey: currentApiKey, baseUrl: AITUDOU_OFFICIAL_BASE_URL }, "utility.wallet", {});
            const nextWallet = parseAitudouWalletSummary(result.raw);
            if (!nextWallet) throw new Error("Unexpected wallet response");
            setWallet(nextWallet);
            setUpdatedAt(new Date());
            setStatus("ready");
        } catch {
            setStatus("error");
        }
    }, [apiKey]);

    useEffect(() => {
        if (!apiKey.trim()) return;
        void refresh();
        const refreshAfterTask = () => void refresh();
        window.addEventListener(AITUDOU_WALLET_REFRESH_EVENT, refreshAfterTask);
        return () => window.removeEventListener(AITUDOU_WALLET_REFRESH_EVENT, refreshAfterTask);
    }, [apiKey, refresh]);

    const updatedLabel = useMemo(() => {
        if (!updatedAt) return null;
        return new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(updatedAt);
    }, [i18n.language, updatedAt]);

    if (!apiKey.trim()) return null;

    const amount = wallet ? formatAitudouWalletAmount(wallet.amount) : "—";
    const label = t("canvas.wallet.balance", { amount });
    const isLoading = status === "loading";
    const isDark = colorTheme === "dark";
    const isReady = Boolean(wallet) && status !== "error";
    const accentColor = status === "error" ? (isDark ? "#fbbf24" : "#b45309") : isReady ? (isDark ? "#6ee7b7" : "#047857") : theme.node.muted;
    const chipStyle = {
        color: accentColor,
        background: status === "error" ? (isDark ? "rgba(245, 158, 11, 0.09)" : "rgba(217, 119, 6, 0.08)") : isReady ? (isDark ? "rgba(16, 185, 129, 0.10)" : "rgba(5, 150, 105, 0.08)") : theme.node.fill,
        borderColor: status === "error" ? (isDark ? "rgba(251, 191, 36, 0.25)" : "rgba(180, 83, 9, 0.20)") : isReady ? (isDark ? "rgba(110, 231, 183, 0.22)" : "rgba(4, 120, 87, 0.18)") : theme.toolbar.border,
    };

    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            content={
                <div className="min-w-52 py-0.5" style={{ color: theme.node.text }}>
                    <div className="text-xs font-medium opacity-60">{t("canvas.wallet.available")}</div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-xl font-semibold tabular-nums tracking-tight" style={{ color: accentColor }}>
                            {amount}
                        </span>
                        {isLoading ? <LoaderCircle className="size-3.5 animate-spin opacity-50" aria-label={t("canvas.wallet.updating")} /> : null}
                    </div>
                    {wallet?.usedAmount !== undefined ? <div className="mt-1 text-xs opacity-55">{t("canvas.wallet.used", { amount: formatAitudouWalletAmount(wallet.usedAmount) })}</div> : null}
                    {status === "error" ? <div className="mt-2 text-xs text-amber-500">{t("canvas.wallet.unavailable")}</div> : null}
                    <div className="mt-3 flex items-center justify-between gap-4 border-t pt-2.5 text-[11px] opacity-60" style={{ borderColor: theme.toolbar.border }}>
                        <span>{updatedLabel ? t("canvas.wallet.updatedAt", { time: updatedLabel }) : t("canvas.wallet.notUpdated")}</span>
                        <button type="button" className="inline-flex items-center gap-1 font-medium opacity-90 transition-opacity hover:opacity-100 disabled:cursor-default disabled:opacity-45" disabled={isLoading} onClick={() => void refresh()}>
                            <RefreshCw className={`size-3 ${isLoading ? "animate-spin" : ""}`} />
                            {t("canvas.wallet.refresh")}
                        </button>
                    </div>
                </div>
            }
        >
            <Tooltip title={label} mouseEnterDelay={0.25}>
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-semibold tabular-nums shadow-[inset_0_1px_rgba(255,255,255,.06)] transition duration-150 ease-out hover:-translate-y-px hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                    style={chipStyle}
                    aria-label={label}
                >
                    {isLoading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <WalletCards className="size-3.5" aria-hidden="true" />}
                    <span className="hidden font-medium opacity-70 sm:inline">{t("canvas.wallet.label")}</span>
                    <span>{wallet ? amount : status === "error" ? "!" : "—"}</span>
                </button>
            </Tooltip>
        </Popover>
    );
}
