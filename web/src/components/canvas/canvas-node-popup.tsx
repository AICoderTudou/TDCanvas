import { createPortal } from "react-dom";
import { useLayoutEffect, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";

export type CanvasNodePopupPlacement = "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";

type CanvasNodeAnchoredPopupProps = {
    open: boolean;
    anchorRef: RefObject<HTMLElement | null>;
    panelRef: RefObject<HTMLDivElement | null>;
    placement?: CanvasNodePopupPlacement;
    width?: number;
    height?: number;
    maxHeight?: number;
    gap?: number;
    flipVertical?: boolean;
    anchorRect?: DOMRect | null;
    className?: string;
    style?: CSSProperties;
    popupProps?: HTMLAttributes<HTMLDivElement>;
    children: ReactNode;
};

type PopupPosition = {
    container: HTMLElement;
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    translateY?: string;
};

export function getCanvasNodePopupContainer(triggerNode: HTMLElement) {
    return triggerNode.closest<HTMLElement>("[data-node-id]") || document.body;
}

export function CanvasNodeAnchoredPopup({
    open,
    anchorRef,
    panelRef,
    placement = "topLeft",
    width = 356,
    height,
    maxHeight: requestedMaxHeight = 620,
    gap = 8,
    flipVertical = false,
    anchorRect,
    className,
    style,
    popupProps,
    children,
}: CanvasNodeAnchoredPopupProps) {
    const [position, setPosition] = useState<PopupPosition | null>(null);

    useLayoutEffect(() => {
        if (!open || !anchorRef.current) {
            setPosition(null);
            return;
        }

        const anchor = anchorRef.current;
        const container = getCanvasNodePopupContainer(anchor);
        const sync = () => {
            const measuredAnchorRect = anchorRect || anchor.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const scaleX = container.offsetWidth ? containerRect.width / container.offsetWidth : 1;
            const scaleY = container.offsetHeight ? containerRect.height / container.offsetHeight : scaleX;
            const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
            const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : safeScaleX;
            const localLeft = (measuredAnchorRect.left - containerRect.left) / safeScaleX;
            const localRight = (measuredAnchorRect.right - containerRect.left) / safeScaleX;
            const localTop = (measuredAnchorRect.top - containerRect.top) / safeScaleY;
            const localBottom = (measuredAnchorRect.bottom - containerRect.top) / safeScaleY;
            const popupWidth = Math.min(width, Math.max(160, (window.innerWidth - 24) / safeScaleX));
            const alignRight = placement.endsWith("Right");
            const alignCenter = placement === "top" || placement === "bottom";
            const desiredLeft = alignCenter ? (localLeft + localRight - popupWidth) / 2 : alignRight ? localRight - popupWidth : localLeft;
            const minLeft = (12 - containerRect.left) / safeScaleX;
            const maxLeft = (window.innerWidth - 12 - containerRect.left) / safeScaleX - popupWidth;
            const left = maxLeft >= minLeft ? clamp(desiredLeft, minLeft, maxLeft) : desiredLeft;
            const prefersTop = placement.startsWith("top");
            const availableTop = measuredAnchorRect.top - gap - 8;
            const availableBottom = window.innerHeight - measuredAnchorRect.bottom - gap - 8;
            const minimumComfortHeight = Math.min(requestedMaxHeight, 240) * safeScaleY;
            const topPlacement = flipVertical ? (prefersTop ? !(availableTop < minimumComfortHeight && availableBottom > availableTop) : availableBottom < minimumComfortHeight && availableTop > availableBottom) : prefersTop;
            const availableHeight = topPlacement ? availableTop : availableBottom;
            const maxHeight = Math.max(64, Math.min(requestedMaxHeight, availableHeight / safeScaleY));
            const next = {
                container,
                left,
                top: topPlacement ? localTop - gap : localBottom + gap,
                width: popupWidth,
                maxHeight,
                translateY: topPlacement ? "-100%" : undefined,
            };
            setPosition((current) => (samePosition(current, next) ? current : next));
        };

        sync();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
        observer?.observe(anchor);
        if (container !== document.body) observer?.observe(container);
        window.addEventListener("resize", sync);
        window.addEventListener("scroll", sync, true);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", sync);
            window.removeEventListener("scroll", sync, true);
        };
    }, [anchorRect, anchorRef, flipVertical, gap, open, placement, requestedMaxHeight, width]);

    if (!open || !position) return null;
    return createPortal(
        <div
            {...popupProps}
            ref={panelRef}
            data-canvas-node-popup
            className={className}
            style={{
                position: "absolute",
                zIndex: 1200,
                left: position.left,
                top: position.top,
                width: position.width,
                height: height ? Math.min(height, position.maxHeight) : undefined,
                maxHeight: position.maxHeight,
                transform: position.translateY ? `translateY(${position.translateY})` : undefined,
                transformOrigin: position.translateY ? "bottom" : "top",
                ...style,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            {children}
        </div>,
        position.container,
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function samePosition(current: PopupPosition | null, next: PopupPosition) {
    return Boolean(
        current &&
        current.container === next.container &&
        Math.abs(current.left - next.left) < 0.1 &&
        Math.abs(current.top - next.top) < 0.1 &&
        Math.abs(current.width - next.width) < 0.1 &&
        Math.abs(current.maxHeight - next.maxHeight) < 0.1 &&
        current.translateY === next.translateY,
    );
}
