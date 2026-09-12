import type { ComponentType, ReactNode, UIEventHandler } from "react";

export function WorkspacePage({ icon: Icon, title, description, meta, actions, children, onScroll }: { icon: ComponentType<{ className?: string }>; title: string; description?: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode; onScroll?: UIEventHandler<HTMLElement> }) {
    return (
        <div className="td-workspace-page h-full overflow-hidden bg-background text-stone-900 dark:text-zinc-100">
            <main className="td-workspace-scroll h-full overflow-y-auto" onScroll={onScroll}>
                <div className="td-workspace-inner mx-auto min-h-full w-full max-w-[1440px] px-6 pb-12">
                    <header className="td-workspace-header flex min-h-[112px] items-center justify-between gap-6 border-b border-black/[0.07] py-6 dark:border-white/[0.07]">
                        <div className="flex min-w-0 items-center gap-4">
                            <span className="grid size-10 shrink-0 place-items-center rounded-[13px] border border-black/[0.08] bg-black/[0.035] text-stone-700 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-zinc-200">
                                <Icon className="size-[18px]" />
                            </span>
                            <div className="min-w-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                                    <h1 className="truncate text-[22px] font-semibold tracking-[-0.025em] text-stone-950 dark:text-zinc-50">{title}</h1>
                                    {meta ? <span className="text-[11px] tabular-nums text-stone-400 dark:text-zinc-500">{meta}</span> : null}
                                </div>
                                {description ? <p className="mt-1 max-w-2xl text-[12px] leading-5 text-stone-500 dark:text-zinc-500">{description}</p> : null}
                            </div>
                        </div>
                        {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
                    </header>
                    <div className="td-workspace-body pt-6">{children}</div>
                </div>
            </main>
        </div>
    );
}
