import localforage from "localforage";

import type { ComfyWorkflowDefinition } from "./index";

const workflowStore = localforage.createInstance({
    name: "tdcanvas-comfyui-local",
    storeName: "workflow_library",
});

const DEFINITIONS_KEY = "definitions-v1";

export async function listComfyWorkflowDefinitions() {
    const stored = await workflowStore.getItem<unknown>(DEFINITIONS_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter(isWorkflowDefinition).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveComfyWorkflowDefinition(definition: ComfyWorkflowDefinition) {
    const current = await listComfyWorkflowDefinitions();
    const existing = current.find((item) => item.id === definition.id);
    const next = [{ ...definition, createdAt: existing?.createdAt || definition.createdAt }, ...current.filter((item) => item.id !== definition.id)];
    await workflowStore.setItem(DEFINITIONS_KEY, next);
    return definition;
}

export async function deleteComfyWorkflowDefinition(id: string) {
    const current = await listComfyWorkflowDefinitions();
    await workflowStore.setItem(
        DEFINITIONS_KEY,
        current.filter((item) => item.id !== id),
    );
}

export async function getComfyWorkflowDefinition(id: string) {
    return (await listComfyWorkflowDefinitions()).find((item) => item.id === id) || null;
}

function isWorkflowDefinition(value: unknown): value is ComfyWorkflowDefinition {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<ComfyWorkflowDefinition>;
    return Boolean(item.id && item.name && item.environmentId && item.apiWorkflow && Array.isArray(item.inputs) && Array.isArray(item.outputs) && item.dependencySnapshot && item.createdAt && item.updatedAt);
}
