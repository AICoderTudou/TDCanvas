import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ClipboardCopy, ClipboardPaste, Plus, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";

type CanvasContextMenuProps = {
    menu: ContextMenuState;
    canUndo: boolean;
    canRedo: boolean;
    canCopyAll: boolean;
    onClose: () => void;
    onUpload: () => void;
    onAddNode: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCopyAll: () => void;
    onPaste: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
};

export function CanvasNodeContextMenu({ menu, canUndo, canRedo, canCopyAll, onClose, onUpload, onAddNode, onUndo, onRedo, onCopyAll, onPaste, onDuplicate, onDelete }: CanvasContextMenuProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: menu.x, top: menu.y });

    useLayoutEffect(() => {
        const rect = menuRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPosition({
            left: Math.max(12, Math.min(menu.x, window.innerWidth - rect.width - 12)),
            top: Math.max(12, Math.min(menu.y, window.innerHeight - rect.height - 12)),
        });
    }, [menu]);

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [onClose]);

    const run = (action: () => void) => {
        action();
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-[80] w-[212px] overflow-hidden rounded-xl border p-1.5 shadow-2xl backdrop-blur-xl"
            data-canvas-context-menu={menu.type}
            style={{ ...position, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "canvas" ? (
                <>
                    <MenuButton icon={<Upload className="size-4" />} label={t("canvas.toolbar.upload")} onClick={() => run(onUpload)} />
                    <MenuButton icon={<Plus className="size-4" />} label={t("canvas.addNode", { defaultValue: "添加节点" })} onClick={() => run(onAddNode)} />
                    <MenuDivider />
                    <MenuButton icon={<Undo2 className="size-4" />} label={t("canvas.undo")} shortcut="Ctrl+Z" onClick={() => run(onUndo)} disabled={!canUndo} />
                    <MenuButton icon={<Redo2 className="size-4" />} label={t("canvas.redo")} shortcut="Ctrl+Shift+Z" onClick={() => run(onRedo)} disabled={!canRedo} />
                    <MenuDivider />
                    <MenuButton icon={<ClipboardCopy className="size-4" />} label={t("canvas.copyAll", { defaultValue: "复制所有节点" })} onClick={() => run(onCopyAll)} disabled={!canCopyAll} />
                    <MenuButton icon={<ClipboardPaste className="size-4" />} label={t("canvas.paste", { defaultValue: "粘贴" })} shortcut="Ctrl+V" onClick={() => run(onPaste)} />
                </>
            ) : (
                <>
                    {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label={t("canvas.controls.duplicate")} onClick={() => run(onDuplicate)} /> : null}
                    <MenuButton icon={<Trash2 className="size-4" />} label={t("canvas.controls.delete")} onClick={() => run(onDelete)} danger />
                </>
            )}
        </div>
    );
}

function MenuDivider() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div className="mx-2 my-1 h-px" style={{ background: theme.toolbar.border, opacity: 0.7 }} />;
}

function MenuButton({ icon, label, shortcut, onClick, danger = false, disabled = false }: { icon: ReactNode; label: string; shortcut?: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button
            type="button"
            disabled={disabled}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
            style={{ color: danger ? "#f87171" : theme.node.text }}
            onClick={onClick}
        >
            <span className="opacity-70">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {shortcut ? <span className="text-[10px] opacity-35">{shortcut}</span> : null}
        </button>
    );
}
