import { useEffect, useRef, useState, type RefObject } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { reasoningEffortLabel, TextSettingsPanel } from "@/components/text-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";
import { CanvasNodeAnchoredPopup } from "./canvas-node-popup";

type CanvasTextSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function CanvasTextSettingsPopover({ config, onConfigChange, buttonClassName, placement = "topLeft" }: CanvasTextSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const panel = <TextSettingsPortal open={open} buttonRef={buttonRef} panelRef={panelRef} placement={placement} theme={theme} config={config} onConfigChange={onConfigChange} />;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button
                    size="small"
                    type="text"
                    className={buttonClassName || "!h-8 !max-w-[170px] !justify-start !rounded-full !px-2.5"}
                    style={{ background: theme.node.fill, color: theme.node.text }}
                    icon={<Settings2 className="size-3.5" />}
                    onClick={() => setOpen((current) => !current)}
                >
                    <span className="truncate">
                        {t("canvas.controls.reasoning")} · {reasoningEffortLabel(config.reasoningEffort)}
                    </span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function TextSettingsPortal({
    open,
    buttonRef,
    panelRef,
    placement,
    theme,
    config,
    onConfigChange,
}: {
    open: boolean;
    buttonRef: RefObject<HTMLSpanElement | null>;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasTextSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    onConfigChange: CanvasTextSettingsPopoverProps["onConfigChange"];
}) {
    return (
        <CanvasNodeAnchoredPopup
            open={open}
            anchorRef={buttonRef}
            panelRef={panelRef}
            placement={placement}
            style={{ background: theme.toolbar.panel, borderRadius: 18, boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)", padding: 18, color: theme.node.text }}
        >
            <TextSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} />
        </CanvasNodeAnchoredPopup>
    );
}
