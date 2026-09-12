import { FileText, FolderPlus, Search } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { useTranslation } from "react-i18next";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const { query, items: promptItems, tags: promptTags, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: selectedCategory });

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("prompts.loadFailed"));
    }, [message, query.error, query.isError, t]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const savePromptAsset = (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        message.success(t("common.addedToAssets"));
    };

    const handleListScroll = (event: UIEvent<HTMLElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <>
            <WorkspacePage icon={FileText} title={t("prompts.title")} description={t("prompts.description")} meta={t("prompts.total", { count: totalPrompts })} onScroll={handleListScroll}>
                <div className="grid items-start gap-7 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <aside className="td-workspace-sidebar thin-scrollbar max-h-[calc(100dvh-12.5rem)] overflow-y-auto pr-1 lg:sticky lg:top-0 lg:border-r lg:border-black/[0.07] lg:pr-6 dark:lg:border-white/[0.07]">
                        <PromptFilter label={t("prompts.category")} options={promptCategoryOptions} selected={selectedCategory} onChange={setSelectedCategory} />
                        <div className="mt-7 border-t border-black/[0.06] pt-6 dark:border-white/[0.06]">
                            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-zinc-600">{t("prompts.tags")}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {promptTags.map((tag) => {
                                    const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                    return (
                                        <FilterChip key={tag} active={active} onClick={() => toggleTag(tag)}>
                                            {tag === ALL_PROMPTS_OPTION ? t("common.all") : tag}
                                        </FilterChip>
                                    );
                                })}
                            </div>
                        </div>
                    </aside>

                    <section className="min-w-0">
                        <div className="td-workspace-toolbar sticky top-0 z-10 -mt-1 flex min-h-14 items-center gap-3 rounded-[15px] border border-black/[0.07] bg-background/90 p-2 backdrop-blur-xl dark:border-white/[0.07]">
                            <Input
                                allowClear
                                prefix={<Search className="size-4 text-stone-400" />}
                                value={titleKeyword}
                                placeholder={t("prompts.search")}
                                className="td-workspace-search"
                                onChange={(event) => setTitleKeyword(event.target.value)}
                            />
                            <span className="hidden shrink-0 px-2 text-[11px] tabular-nums text-stone-400 dark:text-zinc-600 sm:block">{promptItems.length} / {totalPrompts}</span>
                        </div>

                        {query.isLoading ? (
                            <div className="flex min-h-[360px] items-center justify-center"><Spin /></div>
                        ) : (
                            <div className="mt-5">
                                <PromptGrid
                                    items={promptItems}
                                    onOpen={setSelectedPrompt}
                                    renderActions={(item) => <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>{t("common.addToAssets")}</Button>}
                                    onCopy={(item) => copyText(item.prompt, t("common.promptCopied"))}
                                    emptyText={t("prompts.empty")}
                                />
                            </div>
                        )}
                        <div className="min-h-12 pt-6 text-center text-[11px] text-stone-400 dark:text-zinc-600">{query.isFetchingNextPage ? t("prompts.loading") : query.hasNextPage ? t("prompts.loadMore") : promptItems.length > 0 ? t("prompts.end") : null}</div>
                    </section>
                </div>
            </WorkspacePage>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))} onSaveAsset={savePromptAsset} />
        </>
    );
}

function PromptFilter({ label, options, selected, onChange }: { label: string; options: string[]; selected: string; onChange: (value: string) => void }) {
    const { t } = useTranslation();
    return (
        <div>
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-zinc-600">{label}</div>
            <div className="space-y-1">
                {options.map((option) => {
                    const active = selected === option;
                    return (
                        <button key={option} type="button" className={`flex h-9 w-full cursor-pointer items-center justify-between rounded-[10px] px-3 text-left text-[12px] transition ${active ? "bg-black/[0.065] font-medium text-stone-950 dark:bg-white/[0.08] dark:text-white" : "text-stone-500 hover:bg-black/[0.035] hover:text-stone-900 dark:text-zinc-500 dark:hover:bg-white/[0.045] dark:hover:text-zinc-200"}`} onClick={() => onChange(option)}>
                            <span className="truncate">{option === ALL_PROMPTS_OPTION ? t("common.all") : option}</span>
                            {active ? <span className="size-1.5 rounded-full bg-[#756bff] shadow-[0_0_8px_rgba(117,107,255,.7)]" /> : null}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function PromptGrid({ items, onOpen, onCopy, renderActions, emptyText }: { items: Prompt[]; onOpen: (item: Prompt) => void; onCopy: (item: Prompt) => void; renderActions: (item: Prompt) => ReactNode; emptyText: string }) {
    return <div><div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 2xl:grid-cols-3">{items.map((item) => <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} extraAction={renderActions(item)} />)}</div>{items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} className="py-20" /> : null}</div>;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return <button type="button" className={`cursor-pointer rounded-full border px-2.5 py-1 text-[10px] transition ${active ? "border-[#756bff]/45 bg-[#756bff]/12 text-[#665ae7] dark:text-[#aaa3ff]" : "border-black/[0.07] text-stone-500 hover:border-black/[0.16] hover:text-stone-900 dark:border-white/[0.07] dark:text-zinc-500 dark:hover:border-white/[0.16] dark:hover:text-zinc-200"}`} onClick={onClick}>{children}</button>;
}
