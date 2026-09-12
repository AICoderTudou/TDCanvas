export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f4f2ed",
            dot: "rgba(68,64,60,.28)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#1c1917",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#57534e",
            fill: "#e7e5df",
            panel: "#fbfaf7",
            stroke: "#d6d3ca",
            activeStroke: "#1c1917",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        toolbar: {
            panel: "rgba(251,250,247,.96)",
            border: "#d6d3ca",
            item: "#57534e",
            itemHover: "#e7e5df",
            activeBg: "#e7e5df",
            activeText: "#292524",
        },
    },
    dark: {
        canvas: {
            background: "#0d0d0d",
            dot: "rgba(255,255,255,.13)",
            line: "rgba(255,255,255,.06)",
            selectionStroke: "#f4f4f5",
            selectionFill: "rgba(244,244,245,.08)",
        },
        node: {
            label: "#c7c9cc",
            fill: "#17191a",
            panel: "#141617",
            stroke: "#3b3e40",
            activeStroke: "#f4f4f5",
            placeholder: "#8b8f94",
            text: "#f4f4f5",
            muted: "#b7bbc0",
            faint: "#6f7479",
        },
        toolbar: {
            panel: "rgba(20,22,23,.96)",
            border: "#343739",
            item: "#c7c9cc",
            itemHover: "#202324",
            activeBg: "#2b2e30",
            activeText: "#f4f4f5",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
