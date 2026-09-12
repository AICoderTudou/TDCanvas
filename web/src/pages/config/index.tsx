import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { WorkspacePage } from "@/components/layout/workspace-page";

export default function ConfigPage() {
    const { t } = useTranslation();

    return (
        <WorkspacePage icon={Settings2} title={t("config.title")} description={t("config.description")}>
            <div className="mx-auto grid max-w-[980px] items-start gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
                <aside className="lg:sticky lg:top-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-zinc-600">API</div>
                    <h2 className="mt-3 text-[15px] font-semibold text-stone-900 dark:text-zinc-100">{t("config.apiKeyTitle")}</h2>
                    <p className="mt-2 text-[11px] leading-5 text-stone-500 dark:text-zinc-500">{t("config.apiKeyDescription")}</p>
                    <div className="mt-6 h-px bg-black/[0.07] dark:bg-white/[0.07]" />
                    <p className="mt-5 text-[10px] leading-[18px] text-stone-400 dark:text-zinc-600">{t("config.apiKeySecurity")}</p>
                </aside>
                <section className="rounded-[18px] border border-black/[0.08] bg-black/[0.015] p-5 dark:border-white/[0.08] dark:bg-white/[0.025] sm:p-7">
                    <AppConfigPanel />
                </section>
            </div>
        </WorkspacePage>
    );
}
