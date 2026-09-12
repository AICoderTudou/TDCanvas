import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Button, Segmented, Switch } from "antd";
import { CircleDot, FolderOpen, Grid2x2, Group, History, Image as ImageIcon, Info, Moon, Music2, Palette, Plus, Redo2, Scissors, Search, Sparkles, Square, Sun, Trash2, Type, Undo2, Unplug, Upload, UploadCloud, Video, Workflow, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { useCanvasSidePanelStore, type CanvasSidePanelTab } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasInputMode } from "@/types/canvas";

export function CanvasToolbar({
    selectedCount,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    inputMode,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddMaterial,
    onAddGroup,
    onAddExtensionNode,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onDeselect,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onInputModeChange,
}: {
    selectedCount: number;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    inputMode: CanvasInputMode;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddMaterial: () => void;
    onAddConfig?: () => void;
    onAddAitudou?: () => void;
    onAddGroup: () => void;
    onAddExtensionNode: (type: string) => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onInputModeChange: (mode: CanvasInputMode) => void;
}) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [tipY, setTipY] = useState(0);
    const [createOpen, setCreateOpen] = useState(false);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const sidePanelTab = useCanvasSidePanelStore((state) => state.activeTab);
    const openSidePanel = useCanvasSidePanelStore((state) => state.openPanel);
    const closeSidePanel = useCanvasSidePanelStore((state) => state.closePanel);

    useNodeRegistryVersion();
    const extensionDefs = listNodeDefinitions().filter((definition) => definition.showInCreateMenu !== false && getNodePluginId(definition.type) !== "builtin");
    const primaryExtensionDefs = extensionDefs.filter((definition) => definition.createMenuPlacement === "primary");
    const groupedExtensionDefs = extensionDefs.filter((definition) => definition.createMenuPlacement !== "primary");
    const dockStyle: CSSProperties = {
        background: colorTheme === "dark" ? "rgba(15, 17, 18, .92)" : "rgba(250, 250, 248, .92)",
        borderColor: colorTheme === "dark" ? "rgba(255,255,255,.08)" : "rgba(28,25,23,.10)",
        color: theme.toolbar.item,
        boxShadow: colorTheme === "dark" ? "0 12px 32px rgba(0,0,0,.28)" : "0 12px 30px rgba(28,25,23,.10)",
        maxHeight: "calc(100dvh - var(--td-desktop-titlebar-height, 0px) - 136px)",
    };
    const popoverStyle: CSSProperties = {
        background: colorTheme === "dark" ? "rgba(17, 19, 20, .96)" : "rgba(252, 252, 250, .97)",
        borderColor: colorTheme === "dark" ? "rgba(255,255,255,.09)" : "rgba(28,25,23,.11)",
        color: theme.toolbar.item,
    };
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const tip = hovered ? toolLabel(hovered, t) : "";

    useEffect(() => {
        if (!createOpen && !appearanceOpen && !historyOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setCreateOpen(false);
                setAppearanceOpen(false);
                setHistoryOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setCreateOpen(false);
            setAppearanceOpen(false);
            setHistoryOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [appearanceOpen, createOpen, historyOpen]);

    const runCreateAction = (action: () => void) => {
        action();
        setCreateOpen(false);
    };

    const toggleSidePanel = (tab: CanvasSidePanelTab) => {
        setCreateOpen(false);
        setAppearanceOpen(false);
        setHistoryOpen(false);
        onDeselect();
        if (sidePanelOpen && sidePanelTab === tab) closeSidePanel();
        else openSidePanel(tab);
    };

    return (
        <div ref={rootRef} className="td-canvas-toolbar pointer-events-none absolute left-4 top-1/2 z-50 -translate-y-1/2">
            {tip ? <DockTip label={tip} y={tipY} theme={theme} /> : null}
            <span className="pointer-events-none absolute left-7 top-0 z-50 -translate-y-1 whitespace-nowrap rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white shadow-lg">
                {t("canvas.newNodeBadge")}
            </span>
            <div ref={wrapRef} className="td-canvas-dock thin-scrollbar pointer-events-auto flex w-12 flex-col items-center gap-0.5 overflow-y-auto rounded-[20px] border px-1.5 py-2 backdrop-blur-xl [&>*]:shrink-0" style={dockStyle}>
                <ToolbarButton
                    id="tool-create"
                    label={t("canvas.addNode")}
                    active={createOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipY={setTipY}
                    onHover={setHovered}
                    onClick={() => {
                        setAppearanceOpen(false);
                        setHistoryOpen(false);
                        setCreateOpen((value) => !value);
                    }}
                    primary
                >
                    {createOpen ? <X className="size-[18px]" /> : <Plus className="size-[19px]" />}
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton
                    id="tool-search"
                    label={t("canvas.sidePanel.searchNodes")}
                    active={sidePanelOpen && sidePanelTab === "canvas"}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipY={setTipY}
                    onHover={setHovered}
                    onClick={() => toggleSidePanel("canvas")}
                >
                    <Search className="size-4" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-assets"
                    label={t("canvas.sidePanel.assets")}
                    active={sidePanelOpen && sidePanelTab === "assets"}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipY={setTipY}
                    onHover={setHovered}
                    onClick={() => toggleSidePanel("assets")}
                >
                    <FolderOpen className="size-4" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-prompts"
                    label={t("canvas.sidePanel.prompts")}
                    active={sidePanelOpen && sidePanelTab === "prompts"}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipY={setTipY}
                    onHover={setHovered}
                    onClick={() => toggleSidePanel("prompts")}
                >
                    <Sparkles className="size-4" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-history"
                    label={t("canvas.toolbar.history", { defaultValue: "历史" })}
                    active={historyOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipY={setTipY}
                    onHover={setHovered}
                    onClick={() => {
                        setCreateOpen(false);
                        setAppearanceOpen(false);
                        setHistoryOpen((value) => !value);
                    }}
                >
                    <History className="size-4" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-upload"
                    label={t("canvas.toolbar.upload")}
                    hovered={hovered}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipY={setTipY}
                    onHover={setHovered}
                    onClick={() => {
                        setCreateOpen(false);
                        setAppearanceOpen(false);
                        setHistoryOpen(false);
                        onUpload();
                    }}
                >
                    <Upload className="size-4" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-style"
                    label={t("canvas.toolbar.appearance")}
                    active={appearanceOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipY={setTipY}
                    onHover={setHovered}
                    onClick={() => {
                        setCreateOpen(false);
                        setHistoryOpen(false);
                        setAppearanceOpen((value) => !value);
                    }}
                >
                    <Palette className="size-4" />
                </ToolbarButton>
                {selectedCount ? (
                    <ToolbarButton id="tool-delete" label={t("canvas.deleteSelected")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipY={setTipY} onHover={setHovered} onClick={onDelete} danger>
                        <Trash2 className="size-4" />
                    </ToolbarButton>
                ) : null}
                <Divider theme={theme} />
                <ToolbarButton id="tool-clear" label={t("canvas.toolbar.clear")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipY={setTipY} onHover={setHovered} onClick={onClear} danger>
                    <Scissors className="size-4" />
                </ToolbarButton>
            </div>

            {createOpen ? (
                <div className="td-canvas-flyout thin-scrollbar pointer-events-auto absolute left-[calc(100%+24px)] top-[-76px] z-30 max-h-[min(70vh,520px)] w-[212px] overflow-y-auto rounded-xl border p-2 backdrop-blur-xl" style={popoverStyle}>
                    <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold tracking-wide opacity-45">{t("canvas.addNode")}</div>
                    <div className="grid gap-0.5">
                        <CreateMenuItem icon={<Type />} label={t("canvas.toolbar.text")} theme={theme} onClick={() => runCreateAction(onAddText)} />
                        <CreateMenuItem icon={<ImageIcon />} label={t("canvas.toolbar.image")} theme={theme} onClick={() => runCreateAction(onAddImage)} />
                        <CreateMenuItem icon={<Video />} label={t("canvas.toolbar.video")} theme={theme} onClick={() => runCreateAction(onAddVideo)} />
                        <CreateMenuItem icon={<Music2 />} label={t("canvas.toolbar.audio")} theme={theme} onClick={() => runCreateAction(onAddAudio)} />
                        {primaryExtensionDefs.map((definition) => (
                            <CreateMenuItem key={definition.type} icon={definition.icon} label={definition.title} theme={theme} onClick={() => runCreateAction(() => onAddExtensionNode(definition.type))} />
                        ))}
                        <CreateMenuItem icon={<Group />} label={t("canvas.toolbar.group")} theme={theme} onClick={() => runCreateAction(onAddGroup)} />
                    </div>
                    <div className="mx-2 my-2 h-px" style={{ background: theme.toolbar.border }} />
                    <CreateMenuItem icon={<UploadCloud />} label={t("canvas.material.uploadAction")} theme={theme} onClick={() => runCreateAction(onAddMaterial)} />
                    {groupedExtensionDefs.length ? (
                        <>
                            <div className="mx-2 my-2 h-px" style={{ background: theme.toolbar.border }} />
                            <div className="px-2 pb-1.5 text-[11px] font-semibold tracking-wide opacity-45">{t("canvas.toolbar.extensions")}</div>
                            <div className="grid gap-0.5">
                                {groupedExtensionDefs.map((definition) => (
                                    <CreateMenuItem key={definition.type} icon={definition.icon} label={definition.title} theme={theme} onClick={() => runCreateAction(() => onAddExtensionNode(definition.type))} />
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>
            ) : null}

            {appearanceOpen ? (
                <div className="td-canvas-flyout pointer-events-auto absolute left-[calc(100%+10px)] top-0 z-30 w-[248px] rounded-2xl border p-3 backdrop-blur-xl" style={popoverStyle}>
                    <div className="px-1 pb-2 text-sm font-medium opacity-70">{t("canvas.toolbar.appearance")}</div>
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-45">{t("canvas.objectReferences.modeTitle")}</div>
                    <Segmented
                        block
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={inputMode}
                        onChange={(value) => onInputModeChange(value as CanvasInputMode)}
                        options={[
                            {
                                value: "connections",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Workflow className="size-3.5" />
                                        {t("canvas.objectReferences.connectionMode")}
                                    </span>
                                ),
                                title: t("canvas.objectReferences.connectionModeHint"),
                            },
                            {
                                value: "objects",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Unplug className="size-3.5" />
                                        {t("canvas.objectReferences.wirelessMode")}
                                    </span>
                                ),
                                title: t("canvas.objectReferences.wirelessModeHint"),
                            },
                        ]}
                    />
                    <div className="mx-1 my-3 h-px" style={{ background: theme.toolbar.border }} />
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-45">{t("canvas.toolbar.themeMode")}</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                            <Sun className="size-4" />
                            {t("canvas.toolbar.light")}
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                            <Moon className="size-4" />
                            {t("canvas.toolbar.dark")}
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-45">{t("canvas.toolbar.gridStyle")}</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />
                                        {t("canvas.toolbar.dots")}
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />
                                        {t("canvas.toolbar.lines")}
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        {t("canvas.toolbar.blank")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            {t("canvas.toolbar.imageInfo")}
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                    </div>
                </div>
            ) : null}

            {historyOpen ? (
                <div className="td-canvas-flyout pointer-events-auto absolute left-[calc(100%+10px)] top-0 z-30 w-[220px] rounded-2xl border p-2 backdrop-blur-xl" style={popoverStyle}>
                    <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold tracking-wide opacity-45">{t("canvas.toolbar.history", { defaultValue: "历史" })}</div>
                    <CreateMenuItem icon={<Undo2 />} label={t("canvas.undo")} theme={theme} onClick={() => (onUndo(), setHistoryOpen(false))} disabled={!canUndo} />
                    <CreateMenuItem icon={<Redo2 />} label={t("canvas.redo")} theme={theme} onClick={() => (onRedo(), setHistoryOpen(false))} disabled={!canRedo} />
                    <div className="mx-2 mt-2 border-t px-0 pb-1 pt-2 text-[10px] leading-4 opacity-40" style={{ borderColor: theme.toolbar.border }}>
                        {t("canvas.toolbar.autoSave", { defaultValue: "画布更改会自动保存" })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function CreateMenuItem({ icon, label, theme, onClick, disabled = false }: { icon: ReactNode; label: string; theme: CanvasTheme; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30"
            style={{ color: theme.toolbar.item }}
            onClick={onClick}
        >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg opacity-70 transition group-hover:opacity-100 [&>svg]:size-4">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    activeStyle,
    hoverStyle,
    wrapRef,
    onTipY,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    primary = false,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    wrapRef: RefObject<HTMLDivElement | null>;
    onTipY: (y: number) => void;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    primary?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Button
            type="text"
            aria-label={label}
            data-canvas-tool={id}
            className={`td-canvas-tool-button !p-0 ${primary ? "!h-10 !w-10 !min-w-10 !rounded-full" : "!h-8 !w-8 !min-w-8 !rounded-[10px]"}`}
            disabled={disabled}
            style={
                primary
                    ? { background: "#f5f5f4", color: "#111827", opacity: 1, boxShadow: "0 6px 18px rgba(0,0,0,.28)" }
                    : active
                      ? activeStyle
                      : hovered === id && !disabled
                        ? danger
                            ? { background: "rgba(248,113,113,.1)", color: "#f87171" }
                            : hoverStyle
                        : { color: theme.toolbar.item, opacity: disabled ? 0.28 : danger ? 0.58 : 0.82 }
            }
            icon={children}
            onMouseEnter={(event) => {
                onHover(id);
                onTipY(getTipY(wrapRef.current, event.currentTarget));
            }}
            onMouseLeave={() => onHover(null)}
            onClick={onClick}
        />
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="my-1 h-px w-5" style={{ background: theme.toolbar.border, opacity: 0.7 }} />;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const { t } = useTranslation();
    const label = targetTheme === "dark" ? t("topNav.darkTheme") : t("topNav.lightTheme");

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={label}
            title={label}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function DockTip({ label, y, theme }: { label: string; y: number; theme: CanvasTheme }) {
    return (
        <span className="pointer-events-none absolute left-[calc(100%+8px)] z-40 -translate-y-1/2 whitespace-nowrap rounded-lg px-2 py-1 text-xs" style={{ top: y, background: theme.node.text, color: theme.node.panel }}>
            {label}
        </span>
    );
}

function toolLabel(id: string, t: (key: string, options?: { defaultValue?: string }) => string) {
    if (id === "tool-create") return t("canvas.addNode");
    if (id === "tool-search") return t("canvas.sidePanel.searchNodes");
    if (id === "tool-assets") return t("canvas.sidePanel.assets");
    if (id === "tool-prompts") return t("canvas.sidePanel.prompts");
    if (id === "tool-history") return t("canvas.toolbar.history", { defaultValue: "历史" });
    if (id === "tool-upload") return t("canvas.toolbar.upload");
    if (id === "tool-style") return t("canvas.toolbar.appearance");
    if (id === "tool-delete") return t("canvas.deleteSelected");
    if (id === "tool-clear") return t("canvas.toolbar.clear");
    return "";
}

function getTipY(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.top - wrapBox.top + box.height / 2;
}
