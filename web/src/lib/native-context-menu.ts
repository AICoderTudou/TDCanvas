type ContextMenuEventTarget = Pick<Document, "addEventListener" | "removeEventListener">;

/**
 * Suppress the WebView/browser menu without stopping event propagation.
 * Canvas-level React handlers still receive the event and can open TDCanvas menus.
 */
export function installNativeContextMenuGuard(target: ContextMenuEventTarget = document) {
    const preventNativeMenu = (event: Event) => event.preventDefault();
    target.addEventListener("contextmenu", preventNativeMenu, true);
    return () => target.removeEventListener("contextmenu", preventNativeMenu, true);
}
