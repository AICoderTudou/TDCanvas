import { describe, expect, it } from "vitest";

import { installNativeContextMenuGuard } from "./native-context-menu";

describe("installNativeContextMenuGuard", () => {
    it("prevents the browser menu without blocking the app context-menu event", () => {
        const target = new EventTarget();
        let appHandlerCalled = false;
        target.addEventListener("contextmenu", () => {
            appHandlerCalled = true;
        });
        const removeGuard = installNativeContextMenuGuard(target as unknown as Document);
        const event = new Event("contextmenu", { bubbles: true, cancelable: true });

        target.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(appHandlerCalled).toBe(true);
        removeGuard();
    });
});
