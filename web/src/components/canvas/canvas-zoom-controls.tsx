import type { ReactNode } from "react";
import { Compass, Eye, EyeOff, Focus, HelpCircle, Magnet } from "lucide-react";
import { useState } from "react";
import { Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    connectionsVisible: boolean;
    connectionsEnabled: boolean;
    onToggleConnections: () => void;
    snapToGrid: boolean;
    onToggleSnapToGrid: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap, connectionsVisible, connectionsEnabled, onToggleConnections, snapToGrid, onToggleSnapToGrid }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = {
        background: colorTheme === "dark" ? "rgba(15,17,18,.86)" : "rgba(250,250,248,.9)",
        borderColor: colorTheme === "dark" ? "rgba(255,255,255,.08)" : "rgba(28,25,23,.1)",
        color: theme.toolbar.item,
        boxShadow: colorTheme === "dark" ? "0 10px 28px rgba(0,0,0,.24)" : "0 10px 26px rgba(28,25,23,.1)",
    };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const buttonClass = "!h-8 !w-8 !min-w-8 !rounded-[10px] !p-0";
    const connectionToggleLabel = connectionsVisible ? t("canvas.hideConnections") : t("canvas.showConnections");
    const snapToggleLabel = t("canvas.snapToGrid");

    return (
        <div className="absolute bottom-3 left-3 z-50" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex h-9 items-center gap-0.5 rounded-xl border px-1 shadow-lg backdrop-blur-xl" style={dockStyle}>
                <Tooltip title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}>
                    <Button
                        type="text"
                        className={buttonClass}
                        style={isMiniMapOpen ? activeStyle : { color: theme.toolbar.item }}
                        icon={<Compass className="size-4" />}
                        onClick={onToggleMiniMap}
                        aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}
                        data-canvas-view-control="minimap"
                    />
                </Tooltip>
                {connectionsEnabled ? (
                    <Tooltip title={connectionToggleLabel}>
                        <Button
                            type="text"
                            className={buttonClass}
                            style={!connectionsVisible ? activeStyle : { color: theme.toolbar.item }}
                            icon={connectionsVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                            onClick={onToggleConnections}
                            aria-pressed={!connectionsVisible}
                            aria-label={connectionToggleLabel}
                            data-canvas-view-control="connections"
                        />
                    </Tooltip>
                ) : null}
                <Tooltip title={snapToggleLabel}>
                    <Button
                        type="text"
                        className={buttonClass}
                        style={snapToGrid ? activeStyle : { color: theme.toolbar.item }}
                        icon={<Magnet className="size-4" />}
                        onClick={onToggleSnapToGrid}
                        aria-pressed={snapToGrid}
                        aria-label={snapToggleLabel}
                        data-canvas-view-control="snap"
                    />
                </Tooltip>
                <Tooltip title={t("canvas.resetView")}>
                    <Button type="text" className={buttonClass} style={{ color: theme.toolbar.item }} icon={<Focus className="size-4" />} onClick={onReset} aria-label={t("canvas.resetView")} data-canvas-view-control="fit" />
                </Tooltip>
                <span className="mx-0.5 h-4 w-px opacity-70" style={{ background: theme.toolbar.border }} />
                <Tooltip title={t("canvas.zoom")}>
                    <input
                        type="range"
                        min="5"
                        max="500"
                        step="1"
                        value={Math.round(scale * 100)}
                        className="w-[72px] opacity-65 transition-opacity duration-150 hover:opacity-100 focus:opacity-100"
                        style={{ accentColor: theme.node.activeStroke }}
                        onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
                        aria-label={t("canvas.zoom")}
                    />
                </Tooltip>
                <span className="w-9 text-right text-[11px] tabular-nums" style={{ color: theme.node.muted }}>
                    {Math.round(scale * 100)}%
                </span>
                <Tooltip title={t("canvas.shortcuts")}>
                    <Button type="text" className={buttonClass} style={shortcutsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<HelpCircle className="size-4" />} onClick={() => setShortcutsOpen(true)} aria-label={t("canvas.shortcuts")} />
                </Tooltip>
            </div>
            <Modal title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut label={t("canvas.shortcut.dragCanvas")} value={t("canvas.shortcut.pan")} />
                    <Shortcut label={t("canvas.shortcut.wheel")} value={t("canvas.shortcut.zoom")} />
                    <Shortcut label={`Ctrl / Cmd + ${t("canvas.shortcut.drag")}`} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut label={`Shift / Ctrl / Cmd + ${t("canvas.shortcut.click")}`} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut label="Ctrl / Cmd + C / V" value={t("canvas.shortcut.copyPasteNodes")} />
                    <Shortcut label="Delete / Backspace" value={t("canvas.shortcut.delete")} />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-base font-medium">{label}</span>
            <span className="opacity-60">{value}</span>
        </div>
    );
}
