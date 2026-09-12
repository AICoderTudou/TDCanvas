import { describe, expect, it } from "vitest";

import { clampHeight } from "./canvas-resizable-area";

describe("canvas resizable areas", () => {
    it("clamps dragged heights to the usable range", () => {
        expect(clampHeight(40, 96, 420)).toBe(96);
        expect(clampHeight(188.4, 96, 420)).toBe(188);
        expect(clampHeight(900, 96, 420)).toBe(420);
    });
});
