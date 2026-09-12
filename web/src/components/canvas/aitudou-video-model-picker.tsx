import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Check, ChevronDown, ChevronRight, Layers3 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";

import { type AitudouNativeVideoModelCategory, type AitudouNativeVideoModelChoice } from "./aitudou-native-generation";
import { CanvasNodeAnchoredPopup } from "./canvas-node-popup";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export type AitudouVideoModelPickerProps = {
    categories: readonly AitudouNativeVideoModelCategory[];
    value?: string;
    priceLabels: ReadonlyMap<string, string>;
    pricingLoading?: boolean;
    automaticMode?: string | null;
    disabled?: boolean;
    theme: CanvasTheme;
    onChange: (value: string) => void;
};

export function AitudouVideoModelPicker({ categories, value, priceLabels, pricingLoading = false, automaticMode, disabled = false, theme, onChange }: AitudouVideoModelPickerProps) {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const selected = useMemo(() => findVideoModel(categories, value), [categories, value]);
    const [open, setOpen] = useState(false);
    const [activeCategoryId, setActiveCategoryId] = useState(selected?.category.id || categories[0]?.id || "");

    useEffect(() => {
        if (!categories.some((category) => category.id === activeCategoryId)) setActiveCategoryId(selected?.category.id || categories[0]?.id || "");
    }, [activeCategoryId, categories, selected?.category.id]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && (anchorRef.current?.contains(target) || panelRef.current?.contains(target))) return;
            setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [open]);

    const close = (restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) requestAnimationFrame(() => anchorRef.current?.focus());
    };

    const openPicker = () => {
        if (disabled || !categories.length) return;
        setActiveCategoryId(selected?.category.id || categories[0].id);
        setOpen(true);
        requestAnimationFrame(() => {
            const categoryId = selected?.category.id || categories[0].id;
            panelRef.current?.querySelector<HTMLElement>(`[data-video-model-category="${escapeSelector(categoryId)}"]`)?.focus();
        });
    };

    const select = (choice: AitudouNativeVideoModelChoice) => {
        if (choice.disabled) return;
        onChange(choice.value);
        close(true);
    };

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                data-aitudou-video-model-picker
                className="flex min-h-8 min-w-0 max-w-[340px] flex-1 items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs outline-none transition-colors duration-150 hover:bg-white/5 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.node.text }}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={menuId}
                disabled={disabled}
                title={selected ? `${selected.category.label} · ${selected.choice.label}` : "选择视频模型"}
                onClick={() => (open ? close() : openPicker())}
                onKeyDown={(event) => {
                    if (event.key !== "ArrowDown") return;
                    event.preventDefault();
                    openPicker();
                }}
            >
                <Layers3 className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                <span data-video-model-selected-label className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-4">
                    {selected?.choice.label || "选择视频模型"}
                </span>
                <ChevronDown className={`size-3.5 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} style={{ color: theme.node.faint }} />
            </button>

            <CanvasNodeAnchoredPopup open={open} anchorRef={anchorRef} panelRef={panelRef} placement="topLeft" width={760} height={420} maxHeight={460} gap={8} flipVertical>
                <AitudouVideoModelMenu
                    id={menuId}
                    panelRef={panelRef}
                    categories={categories}
                    activeCategoryId={activeCategoryId}
                    selectedValue={value}
                    priceLabels={priceLabels}
                    pricingLoading={pricingLoading}
                    automaticMode={automaticMode}
                    theme={theme}
                    onActiveCategoryChange={setActiveCategoryId}
                    onSelect={select}
                    onClose={() => close(true)}
                />
            </CanvasNodeAnchoredPopup>
        </>
    );
}

export function AitudouVideoModelMenu({
    id,
    panelRef,
    categories,
    activeCategoryId,
    selectedValue,
    priceLabels,
    pricingLoading,
    automaticMode,
    theme,
    onActiveCategoryChange,
    onSelect,
    onClose,
}: {
    id: string;
    panelRef?: RefObject<HTMLDivElement | null>;
    categories: readonly AitudouNativeVideoModelCategory[];
    activeCategoryId: string;
    selectedValue?: string;
    priceLabels: ReadonlyMap<string, string>;
    pricingLoading?: boolean;
    automaticMode?: string | null;
    theme: CanvasTheme;
    onActiveCategoryChange: (categoryId: string) => void;
    onSelect: (choice: AitudouNativeVideoModelChoice) => void;
    onClose?: () => void;
}) {
    const activeCategory = categories.find((category) => category.id === activeCategoryId) || categories[0];
    const selectedCategoryId = categories.find((category) => category.options.some((choice) => choice.value === selectedValue))?.id;

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const panel = panelRef?.current || event.currentTarget;
        const target = event.target as HTMLElement;
        const categoryButton = target.closest<HTMLElement>("[data-video-model-category]");
        const optionButton = target.closest<HTMLElement>("[data-video-model-option]");
        if (event.key === "Escape") {
            event.preventDefault();
            onClose?.();
            return;
        }
        if (event.key === "Tab") {
            const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')).filter((item) => item.offsetParent !== null);
            if (!focusable.length) return;
            const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
            const nextIndex = event.shiftKey ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1) : currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
            event.preventDefault();
            focusable[nextIndex]?.focus();
            return;
        }
        if (categoryButton && event.key === "ArrowRight") {
            event.preventDefault();
            const preferred = panel.querySelector<HTMLElement>(`[data-video-model-option="${escapeSelector(selectedValue || "")}"]:not([disabled])`);
            (preferred || panel.querySelector<HTMLElement>("[data-video-model-option]:not([disabled])"))?.focus();
            return;
        }
        if (optionButton && event.key === "ArrowLeft") {
            event.preventDefault();
            panel.querySelector<HTMLElement>(`[data-video-model-category="${escapeSelector(activeCategory?.id || "")}"]`)?.focus();
            return;
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        const selector = categoryButton ? "[data-video-model-category]" : optionButton ? "[data-video-model-option]:not([disabled])" : "";
        if (!selector) return;
        const items = Array.from(panel.querySelectorAll<HTMLElement>(selector));
        const currentIndex = items.indexOf(categoryButton || optionButton!);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowUp" ? (currentIndex - 1 + items.length) % items.length : (currentIndex + 1) % items.length;
        event.preventDefault();
        items[nextIndex]?.focus();
    };

    return (
        <div
            id={id}
            role="dialog"
            aria-label="选择视频模型"
            data-aitudou-video-model-menu
            className="grid size-full min-h-0 overflow-hidden rounded-[14px] border shadow-2xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, gridTemplateColumns: "minmax(164px, 190px) minmax(0, 1fr)", boxShadow: "0 16px 48px rgba(0,0,0,.32)" }}
            onKeyDown={onKeyDown}
        >
            <section className="flex min-h-0 flex-col border-r" style={{ borderColor: theme.toolbar.border }}>
                <div className="shrink-0 border-b px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                    <div className="text-[10px] font-medium" style={{ color: theme.node.faint }}>
                        当前模式
                    </div>
                    <div className="mt-1 inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[11px] font-medium" style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.node.muted }}>
                        <span className="truncate">{automaticMode || "自动识别输入素材"}</span>
                    </div>
                </div>
                <div className="shrink-0 px-3 pb-1 pt-2 text-[10px] font-medium" style={{ color: theme.node.faint }}>
                    模型大类
                </div>
                <div role="listbox" aria-label="视频模型大类" className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    {categories.map((category) => {
                        const active = category.id === activeCategory?.id;
                        const selected = category.id === selectedCategoryId;
                        return (
                            <button
                                key={category.id}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                data-video-model-category={category.id}
                                className="group flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] outline-none transition-colors duration-150 focus-visible:ring-2"
                                style={{ background: selected ? theme.toolbar.activeBg : active ? theme.toolbar.itemHover : undefined, color: active || selected ? theme.node.text : theme.node.muted }}
                                onMouseEnter={() => onActiveCategoryChange(category.id)}
                                onFocus={() => onActiveCategoryChange(category.id)}
                                onClick={() => onActiveCategoryChange(category.id)}
                            >
                                <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: theme.node.fill, color: theme.node.muted }}>
                                    <Layers3 className="size-3.5" />
                                </span>
                                <span className="min-w-0 flex-1 truncate font-medium">{category.label}</span>
                                <span className="shrink-0 text-[10px] tabular-nums" style={{ color: theme.node.faint }}>
                                    {category.options.length}
                                </span>
                                <ChevronRight className="size-3.5 shrink-0" style={{ color: theme.node.faint }} />
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="flex min-h-0 flex-col">
                <div className="flex h-[54px] shrink-0 items-center justify-between gap-3 border-b px-3" style={{ borderColor: theme.toolbar.border }}>
                    <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold">{activeCategory?.label || "模型版本"}</div>
                        <div className="mt-0.5 text-[10px]" style={{ color: theme.node.faint }}>
                            选择具体模型版本
                        </div>
                    </div>
                    <span className="shrink-0 text-[10px] tabular-nums" style={{ color: theme.node.faint }}>
                        {activeCategory?.options.length || 0} 个
                    </span>
                </div>
                <div role="listbox" aria-label={`${activeCategory?.label || "视频"}模型版本`} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
                    {activeCategory?.options.map((choice) => {
                        const selected = choice.value === selectedValue;
                        const capabilities = choice.capabilities.slice(0, 3);
                        return (
                            <button
                                key={choice.value}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                aria-disabled={choice.disabled || undefined}
                                disabled={choice.disabled}
                                data-video-model-option={choice.value}
                                className="mb-1 flex min-h-[58px] w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-150 last:mb-0 hover:bg-white/5 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45"
                                style={{ background: selected ? theme.toolbar.activeBg : undefined, color: theme.node.text }}
                                title={choice.disabledReason ? `${choice.label} · ${choice.disabledReason}` : choice.label}
                                onClick={() => onSelect(choice)}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
                                        <span data-video-model-option-label={choice.value} className="min-w-0 whitespace-normal break-words text-[13px] font-medium leading-[18px]">
                                            {choice.label}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-1.5">
                                            <span className="text-[11px] font-medium tabular-nums" style={{ color: choice.disabled ? theme.node.faint : "#66d99b" }}>
                                                {pricingLoading ? "读取中…" : priceLabels.get(choice.value) || "价格待确认"}
                                            </span>
                                            {selected ? <Check className="size-3.5 shrink-0" /> : null}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
                                        {capabilities.map((capability) => (
                                            <span key={capability} className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] leading-3" style={{ borderColor: theme.toolbar.border, color: theme.node.faint }}>
                                                {capability}
                                            </span>
                                        ))}
                                        {choice.capabilities.length > capabilities.length ? (
                                            <span className="shrink-0 text-[9px]" style={{ color: theme.node.faint }}>
                                                +{choice.capabilities.length - capabilities.length}
                                            </span>
                                        ) : null}
                                        {choice.disabledReason ? (
                                            <span className="min-w-0 truncate text-[9px]" style={{ color: theme.node.faint }}>
                                                {choice.disabledReason}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}

function findVideoModel(categories: readonly AitudouNativeVideoModelCategory[], value?: string) {
    for (const category of categories) {
        const choice = category.options.find((option) => option.value === value);
        if (choice) return { category, choice };
    }
    return undefined;
}

function escapeSelector(value: string) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    return value.replace(/["\\]/g, "\\$&");
}
