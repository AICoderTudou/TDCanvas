import type { ComfyInspectedInput, ComfyInspectedOutput } from "./index";

export type ComfySelectableItem = ComfyInspectedInput | ComfyInspectedOutput;

export type ComfySelectionGroup = {
    nodeId: string;
    nodeTitle: string;
    classType: string;
    items: ComfySelectableItem[];
};

export function smartDefaultComfyInputIds(inputs: ComfyInspectedInput[]) {
    return inputs.filter((input) => input.exposable && input.recommended).map((input) => input.id);
}

export function filterComfySelectionItemsByNodeId<T extends ComfySelectableItem>(items: T[], query: string) {
    const normalized = query.trim().toLowerCase().replace(/^#/, "");
    if (!normalized) return items;
    return items.filter((item) => item.nodeId.toLowerCase().includes(normalized));
}

export function groupComfySelectionItems(items: ComfySelectableItem[]): ComfySelectionGroup[] {
    const groups = new Map<string, ComfySelectionGroup>();
    for (const item of items) {
        const current = groups.get(item.nodeId);
        if (current) current.items.push(item);
        else groups.set(item.nodeId, { nodeId: item.nodeId, nodeTitle: item.nodeTitle, classType: item.classType, items: [item] });
    }
    return [...groups.values()];
}

export function defaultComfyPortIds(inputs: ComfyInspectedInput[], outputIds: string[]) {
    return [
        ...inputs
            .filter((input) => input.recommended && (input.valueType === "image" || input.valueType === "video" || input.valueType === "audio" || (input.valueType === "string" && (input.options.multiline || /prompt|text/i.test(input.field)))))
            .map((input) => input.id),
        ...outputIds,
    ];
}
