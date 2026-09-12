import type { CanvasNodeData } from "@/types/canvas";

import type { AitudouSubmission } from "./aitudou";

const JOURNAL_KEY = "tdcanvas:aitudou_task_journal:v1";

type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type AitudouTaskJournalEntry = {
    projectId: string;
    nodeId: string;
    nodeSnapshot: CanvasNodeData;
    operationId: string;
    channelId?: string;
    family: AitudouSubmission["family"];
    taskIds: string[];
    pollPaths: string[];
    submittedAt: string;
};

export function journalAitudouSubmission(input: { projectId: string; node: CanvasNodeData; operationId: string; channelId?: string; submission: AitudouSubmission }, storage: JournalStorage | null = browserStorage()) {
    if (!storage) return false;
    try {
        const entries = readEntries(storage);
        const existing = entries.find((entry) => entry.projectId === input.projectId && entry.nodeId === input.node.id);
        const taskIds = unique([...(existing?.taskIds || []), input.submission.taskId]);
        const pollPaths = unique([...(existing?.pollPaths || []), input.submission.pollPath]);
        const providerTask = {
            provider: "aitudou" as const,
            taskId: taskIds[0],
            taskIds,
            action: input.operationId,
            family: input.submission.family,
            phase: "queued" as const,
            status: "submitted",
            progress: 0,
            pollPath: pollPaths[0],
            pollPaths,
            submittedAt: existing?.submittedAt || new Date().toISOString(),
        };
        const nodeSnapshot: CanvasNodeData = {
            ...input.node,
            metadata: {
                ...input.node.metadata,
                channelId: input.channelId,
                aitudouOperation: input.operationId,
                status: "idle",
                errorDetails: undefined,
                providerTask,
                providerResult: undefined,
            },
        };
        const next: AitudouTaskJournalEntry = {
            projectId: input.projectId,
            nodeId: input.node.id,
            nodeSnapshot,
            operationId: input.operationId,
            channelId: input.channelId,
            family: input.submission.family,
            taskIds,
            pollPaths,
            submittedAt: providerTask.submittedAt,
        };
        writeEntries(storage, entries.filter((entry) => entry.projectId !== input.projectId || entry.nodeId !== input.node.id).concat(next));
        return true;
    } catch {
        return false;
    }
}

export function mergeAitudouTaskJournal(projectId: string, nodes: CanvasNodeData[], storage: JournalStorage | null = browserStorage()) {
    if (!storage) return nodes;
    try {
        const entries = readEntries(storage);
        const projectEntries = entries.filter((entry) => entry.projectId === projectId);
        if (!projectEntries.length) return nodes;
        const nextNodes = [...nodes];
        const retained = entries.filter((entry) => entry.projectId !== projectId);

        projectEntries.forEach((entry) => {
            const index = nextNodes.findIndex((node) => node.id === entry.nodeId);
            const existing = index >= 0 ? nextNodes[index] : undefined;
            const persistedTaskIds = unique([...(existing?.metadata?.providerTask?.taskIds || []), ...(existing?.metadata?.providerTask?.taskId ? [existing.metadata.providerTask.taskId] : [])]);
            if (entry.taskIds.every((taskId) => persistedTaskIds.includes(taskId))) return;

            const base = existing || entry.nodeSnapshot;
            const taskIds = unique([...persistedTaskIds, ...entry.taskIds]);
            const pollPaths = unique([...(base.metadata?.providerTask?.pollPaths || []), ...(base.metadata?.providerTask?.pollPath ? [base.metadata.providerTask.pollPath] : []), ...entry.pollPaths]);
            const recovered: CanvasNodeData = {
                ...base,
                metadata: {
                    ...base.metadata,
                    channelId: entry.channelId || base.metadata?.channelId,
                    aitudouOperation: entry.operationId,
                    status: "idle",
                    errorDetails: undefined,
                    providerTask: {
                        provider: "aitudou",
                        ...base.metadata?.providerTask,
                        taskId: taskIds[0],
                        taskIds,
                        action: entry.operationId,
                        family: entry.family,
                        phase: "stopped",
                        status: "recovered_from_journal",
                        pollPath: pollPaths[0],
                        pollPaths,
                        submittedAt: base.metadata?.providerTask?.submittedAt || entry.submittedAt,
                        message: "已从本地即时任务日志恢复，可继续查询远端任务。",
                    },
                },
            };
            if (index >= 0) nextNodes[index] = recovered;
            else nextNodes.push(recovered);
            retained.push(entry);
        });

        writeEntries(storage, retained);
        return nextNodes;
    } catch {
        return nodes;
    }
}

export function clearAitudouTaskJournal(projectId: string, nodeId: string, storage: JournalStorage | null = browserStorage()) {
    if (!storage) return;
    try {
        const next = readEntries(storage).filter((entry) => entry.projectId !== projectId || entry.nodeId !== nodeId);
        writeEntries(storage, next);
    } catch {
        // Recovery storage is best-effort and must never break the canvas.
    }
}

function browserStorage(): JournalStorage | null {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
}

function readEntries(storage: JournalStorage): AitudouTaskJournalEntry[] {
    const raw = storage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AitudouTaskJournalEntry[]) : [];
}

function writeEntries(storage: JournalStorage, entries: AitudouTaskJournalEntry[]) {
    if (entries.length) storage.setItem(JOURNAL_KEY, JSON.stringify(entries));
    else storage.removeItem(JOURNAL_KEY);
}

function unique(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}
