import { App, Button, Form, Input, Modal, theme } from "antd";
import { ArrowUpRight, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

import { runAitudouOperation } from "@/services/api/aitudou";
import { formatAitudouWalletAmount, parseAitudouWalletSummary, type AitudouWalletSummary } from "@/services/api/aitudou-wallet";
import { AITUDOU_OFFICIAL_BASE_URL, useConfigStore, type ConfigTabKey } from "@/stores/use-config-store";

type AppConfigPanelProps = {
    showDoneButton?: boolean;
    /** Kept for callers that used to open a specific settings tab. */
    initialTab?: ConfigTabKey;
};

export function AppConfigPanel({ showDoneButton = false }: AppConfigPanelProps) {
    const { message } = App.useApp();
    const { token } = theme.useToken();
    const { t } = useTranslation();
    const apiKey = useConfigStore((state) => state.config.apiKey);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const [draftApiKey, setDraftApiKey] = useState(apiKey);
    const [checkingWallet, setCheckingWallet] = useState(false);
    const [wallet, setWallet] = useState<AitudouWalletSummary | null>(null);

    useEffect(() => {
        setDraftApiKey(apiKey);
        setWallet(null);
    }, [apiKey]);

    const saveApiKey = () => {
        const nextApiKey = draftApiKey.trim();
        updateConfig("apiKey", nextApiKey);
        if (showDoneButton) setConfigDialogOpen(false);
        message.success(t(nextApiKey ? (shouldPromptContinue ? "config.savedContinue" : "config.saved") : "config.apiKeyCleared"));
        clearPromptContinue();
    };

    const checkWallet = async () => {
        const nextApiKey = draftApiKey.trim();
        if (!nextApiKey) return;
        setCheckingWallet(true);
        setWallet(null);
        try {
            const result = await runAitudouOperation({ apiKey: nextApiKey, baseUrl: AITUDOU_OFFICIAL_BASE_URL }, "utility.wallet", {});
            const summary = parseAitudouWalletSummary(result.raw);
            if (!summary) throw new Error(t("config.apiKeyWalletUnexpected"));
            setWallet(summary);
            message.success(t("config.apiKeyVerified"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.apiKeyVerifyFailed"));
        } finally {
            setCheckingWallet(false);
        }
    };

    return (
        <Form className="td-config-form w-full" layout="vertical" requiredMark={false} onFinish={saveApiKey}>
            <div className="flex items-start gap-3 border-b border-black/[0.07] pb-5 dark:border-white/[0.07]">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-[#756bff]/20 bg-[#756bff]/10 text-[#6b5fed] dark:text-[#aaa3ff]">
                    <KeyRound className="size-4" />
                </div>
                <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-stone-950 dark:text-zinc-100">{t("config.apiKeyTitle")}</div>
                    <p className="mt-1 text-[11px] leading-5 text-stone-500 dark:text-zinc-500">{t("config.apiKeyDescription")}</p>
                </div>
            </div>

            <div className="mt-5 flex flex-col gap-4 rounded-[14px] border p-5" style={{ background: token.colorFillAlter, borderColor: token.colorBorder }}>
                <div className="min-w-0">
                    <div className="text-base font-semibold" style={{ color: token.colorText }}>{t("config.apiKeyGuideTitle")}</div>
                    <p className="mt-2 text-sm leading-6" style={{ color: token.colorTextSecondary }}>{t("config.apiKeyGuideDescription")}</p>
                </div>
                <Button
                    type="primary"
                    size="large"
                    block
                    href="https://api.aitudou.net/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="!h-12 !font-semibold"
                    onClick={(event) => {
                        if (!("__TAURI_INTERNALS__" in window)) return;
                        event.preventDefault();
                        void invoke("open_aitudou_registration").catch(() => message.error(t("config.apiKeyGuideOpenFailed")));
                    }}
                >
                    <span className="inline-flex items-center gap-1.5">
                        {t("config.apiKeyGuideAction")}
                        <ArrowUpRight className="size-4" />
                    </span>
                </Button>
            </div>

            <Form.Item label={t("config.apiKeyConnectStep")} className="mb-0 mt-6">
                <Input.Password
                    autoFocus={showDoneButton}
                    autoComplete="off"
                    size="large"
                    value={draftApiKey}
                    placeholder={t("config.apiKeyPlaceholder")}
                    onChange={(event) => {
                        setDraftApiKey(event.target.value);
                        setWallet(null);
                    }}
                />
            </Form.Item>

            {wallet ? (
                <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                    <div className="font-medium">{t("config.apiKeyWalletBalance", { amount: formatAitudouWalletAmount(wallet.amount), currency: wallet.currency })}</div>
                    {wallet.usedAmount !== undefined ? <div className="mt-1 opacity-70">{t("config.apiKeyWalletUsed", { amount: formatAitudouWalletAmount(wallet.usedAmount), currency: wallet.currency })}</div> : null}
                </div>
            ) : null}

            <div className="mt-3 flex items-center gap-2 text-xs text-stone-500">
                <ShieldCheck className="size-3.5 shrink-0" />
                <span>{t("config.apiKeySecurity")}</span>
            </div>

            <div className="mt-7 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-5 dark:border-white/[0.06]">
                <Button type="text" loading={checkingWallet} disabled={!draftApiKey.trim()} onClick={() => void checkWallet()}>
                    {t("config.apiKeyVerify")}
                </Button>
                <Button type="primary" htmlType="submit" disabled={draftApiKey.trim() === apiKey}>
                    {t("common.save")}
                </Button>
            </div>
        </Form>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">{t("config.title")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("config.modalDescription")}</div>
                </div>
            }
            open={isConfigOpen}
            width={520}
            centered
            destroyOnHidden
            onCancel={() => setConfigDialogOpen(false)}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}
