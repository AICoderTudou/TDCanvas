import i18n from "@/i18n";
import { resolveCanvasNodeResource, resolveCanvasObjectReferenceResource } from "@/lib/canvas/canvas-resource-references";
import { resolveDownloadBlob } from "@/services/media-download";
import { desktopFileUrl } from "@/services/platform/desktop-runtime";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeContext, CanvasNodeResource } from "@/types/canvas-plugin";

import { comfyNativeClient, materializeComfyWorkflow, type ComfyExecutionOutput, type ComfyWorkflowDefinition } from "./index";
import { getComfyWorkflowDefinition } from "./workflow-library";
import { ensureComfyResultNodeOps, readComfyResultBinding } from "./result-nodes";
import type { ComfyCanvasNodeSnapshot } from "./canvas-node";

type ActiveRun = { promptId?: string; canceled: boolean };
const activeRuns = new Map<string, ActiveRun>();

export function isComfyWorkflowRunning(node: CanvasNodeData) {
    return activeRuns.has(node.id) || readComfyRun(node.metadata)?.phase === "queued" || readComfyRun(node.metadata)?.phase === "running";
}

export async function runComfyWorkflowNode(ctx: CanvasNodeContext) {
    if (activeRuns.has(ctx.node.id)) return;
    const snapshot = readComfySnapshot(ctx.node.metadata);
    if (!snapshot) return setSourceError(ctx, i18n.t("comfyuiLocal.execution.chooseWorkflow"));
    if (!snapshot.runnable) return setSourceError(ctx, i18n.t("comfyuiLocal.execution.dependenciesMissing"));
    const active: ActiveRun = { canceled: false };
    activeRuns.set(ctx.node.id, active);
    const startedAt = Date.now();
    try {
        const definition = await getComfyWorkflowDefinition(snapshot.workflowId);
        if (!definition) throw new Error(i18n.t("comfyuiLocal.execution.workflowMissing"));
        const status = await comfyNativeClient.status();
        if (status.phase !== "running") throw new Error(i18n.t("comfyuiLocal.execution.environmentStopped"));
        if (status.profileId !== snapshot.environmentId) throw new Error(i18n.t("comfyuiLocal.execution.environmentMismatch"));

        const source = ctx.getNode(ctx.node.id) || ctx.node;
        markSourceAndResults(ctx, "loading", { phase: "preparing", startedAt });

        const disabledInputIds = new Set(definition.inputs.filter((input) => snapshot.inputEnabled?.[input.id] === false).map((input) => input.id));
        const connectedValues = await collectConnectedValues(ctx, definition, disabledInputIds);
        if (active.canceled) return;
        const workflow = materializeComfyWorkflow(definition, snapshot.values, connectedValues, disabledInputIds);
        const queued = await comfyNativeClient.queueWorkflow(snapshot.environmentId, workflow);
        active.promptId = queued.promptId;
        ensureResultNodes(ctx, source, definition, [], queued.promptId);
        markSourceAndResults(ctx, "loading", { phase: "running", promptId: queued.promptId, startedAt }, queued.promptId);

        const result = await comfyNativeClient.waitForExecution(snapshot.environmentId, queued.promptId, definition.outputs, ctx.canvasTitle);
        if (active.canceled) return;
        applyExecutionResult(ctx, source, definition, result.outputs, result.promptId, result.completedAt);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (active.canceled) {
            markSourceAndResults(ctx, "idle", { phase: "canceled", promptId: active.promptId, startedAt, completedAt: Date.now() }, active.promptId);
        } else {
            setSourceError(ctx, message, { phase: "failed", promptId: active.promptId, startedAt, completedAt: Date.now() });
            markResultNodes(ctx, "error", message, active.promptId);
        }
    } finally {
        if (activeRuns.get(ctx.node.id) === active) activeRuns.delete(ctx.node.id);
    }
}

export async function stopComfyWorkflowNode(ctx: CanvasNodeContext) {
    const active = activeRuns.get(ctx.node.id);
    const snapshot = readComfySnapshot(ctx.node.metadata);
    if (!active || !snapshot) return;
    active.canceled = true;
    if (active.promptId) await comfyNativeClient.interruptExecution(snapshot.environmentId, active.promptId).catch(() => undefined);
    markSourceAndResults(ctx, "idle", { phase: "canceled", promptId: active.promptId, completedAt: Date.now() }, active.promptId);
}

async function collectConnectedValues(ctx: CanvasNodeContext, definition: ComfyWorkflowDefinition, disabledInputIds: ReadonlySet<string>) {
    const values: Record<string, unknown> = {};
    for (const input of definition.inputs) {
        if (disabledInputIds.has(input.id)) continue;
        const objectReference = ctx.node.metadata?.objectReferences?.find((reference) => reference.targetInputId === input.id);
        const connection = objectReference ? undefined : ctx.getInputConnections(input.id)[0];
        if (!objectReference && !connection) continue;
        const source = ctx.getNode(objectReference?.sourceNodeId || connection!.fromNodeId);
        const resource = source ? (objectReference ? resolveCanvasObjectReferenceResource(source, objectReference) : resolveCanvasNodeResource(source, connection?.fromPortId)) : null;
        if (!source || !resource) throw new Error(i18n.t("comfyuiLocal.execution.inputUnavailable", { name: input.label }));
        if (input.valueType === "string" || input.valueType === "enum" || input.valueType === "json") {
            values[input.id] = resource.kind === "text" ? resource.text || "" : resource.url || "";
            continue;
        }
        if (input.valueType === "integer" || input.valueType === "number") {
            const parsed = Number(resource.text);
            if (!Number.isFinite(parsed)) throw new Error(i18n.t("comfyuiLocal.execution.inputInvalidNumber", { name: input.label }));
            values[input.id] = parsed;
            continue;
        }
        if (input.valueType === "boolean") {
            values[input.id] = resource.text === "true" || resource.text === "1";
            continue;
        }
        values[input.id] = await uploadConnectedMedia(definition.environmentId, source, resource);
    }
    return values;
}

async function uploadConnectedMedia(environmentId: string, source: CanvasNodeData, resource: CanvasNodeResource) {
    if (resource.kind === "text" || !resource.url) throw new Error(i18n.t("comfyuiLocal.execution.mediaUnavailable", { name: source.title }));
    const blob = await resolveDownloadBlob({ kind: resource.kind, url: resource.url, storageKey: resource.storageKey, localPath: resource.localPath, mimeType: resource.mimeType });
    const filename = source.metadata?.filename || resource.name || `tdcanvas-${source.id}.${extensionForMime(blob.type, resource.kind)}`;
    const uploaded = await comfyNativeClient.uploadInput(environmentId, filename, blob.type || resource.mimeType || fallbackMime(resource.kind), Array.from(new Uint8Array(await blob.arrayBuffer())));
    return uploaded.subfolder ? `${uploaded.subfolder.replace(/\\/g, "/")}/${uploaded.name}` : uploaded.name;
}

function ensureResultNodes(ctx: CanvasNodeContext, source: CanvasNodeData, definition: ComfyWorkflowDefinition, outputs: ComfyExecutionOutput[] = [], promptId?: string) {
    const indexes = outputs.reduce<Record<string, number[]>>((result, output) => {
        (result[output.outputId] ||= []).push(output.itemIndex);
        return result;
    }, {});
    const ops = ensureComfyResultNodeOps(source, definition, ctx.getNodes(), ctx.getConnections(), { promptId, itemIndexes: indexes });
    if (ops.length) ctx.applyOps(ops);
}

function applyExecutionResult(ctx: CanvasNodeContext, source: CanvasNodeData, definition: ComfyWorkflowDefinition, outputs: ComfyExecutionOutput[], promptId: string, completedAt: number) {
    if (!outputs.length) throw new Error(i18n.t("comfyuiLocal.execution.noResults"));
    ensureResultNodes(ctx, source, definition, outputs, promptId);
    const operations: CanvasAgentOp[] = [];
    const completedKeys = new Set(outputs.map((output) => `${output.outputId}:${output.itemIndex}`));
    for (const output of outputs) {
        const node = findResultNode(ctx.getNodes(), source.id, output.outputId, output.itemIndex, promptId);
        if (!node) continue;
        operations.push({ type: "update_node", id: node.id, metadata: resultMetadata(node, output, promptId, completedAt) });
    }
    for (const node of ctx.getNodes()) {
        const binding = readComfyResultBinding(node);
        if (!binding || binding.sourceNodeId !== source.id || node.metadata?.comfyuiPromptId !== promptId || completedKeys.has(`${binding.outputId}:${binding.itemIndex}`)) continue;
        operations.push({ type: "update_node", id: node.id, metadata: { status: "error", errorDetails: i18n.t("comfyuiLocal.execution.outputMissing") } });
    }
    operations.push({ type: "update_node", id: source.id, metadata: { status: "success", errorDetails: undefined, comfyuiRun: { phase: "succeeded", promptId, completedAt } } });
    ctx.applyOps(operations);
}

function resultMetadata(node: CanvasNodeData, output: ComfyExecutionOutput, promptId: string, completedAt: number): CanvasNodeMetadata {
    const content = output.absolutePath ? desktopFileUrl(output.absolutePath) : output.text || (output.raw === undefined ? "" : JSON.stringify(output.raw, null, 2));
    const common: CanvasNodeMetadata = {
        ...node.metadata,
        content,
        localPath: output.absolutePath,
        filename: output.filename,
        mimeType: output.mimeType,
        bytes: output.bytes,
        status: "success",
        errorDetails: undefined,
        sourceOrigin: "generated",
        comfyuiPromptId: promptId,
        comfyuiCompletedAt: completedAt,
    };
    if (output.resourceType === "file") {
        common.providerResult = {
            outputs: [{ kind: "file", url: content, localPath: output.absolutePath, filename: output.filename, mimeType: output.mimeType, bytes: output.bytes }],
        };
    }
    return common;
}

function markSourceAndResults(ctx: CanvasNodeContext, status: "idle" | "loading", run: Record<string, unknown>, promptId?: string) {
    const operations: CanvasAgentOp[] = [{ type: "update_node", id: ctx.node.id, metadata: { status, errorDetails: undefined, comfyuiRun: run } }];
    for (const node of ctx.getNodes()) {
        const binding = readComfyResultBinding(node);
        if (binding?.sourceNodeId === ctx.node.id && promptId && node.metadata?.comfyuiPromptId === promptId) operations.push({ type: "update_node", id: node.id, metadata: { status, errorDetails: undefined } });
    }
    ctx.applyOps(operations);
}

function markResultNodes(ctx: CanvasNodeContext, status: "error", errorDetails: string, promptId?: string) {
    const operations = ctx
        .getNodes()
        .filter((node) => readComfyResultBinding(node)?.sourceNodeId === ctx.node.id && promptId && node.metadata?.comfyuiPromptId === promptId)
        .map((node): CanvasAgentOp => ({ type: "update_node", id: node.id, metadata: { status, errorDetails } }));
    if (operations.length) ctx.applyOps(operations);
}

function setSourceError(ctx: CanvasNodeContext, errorDetails: string, run: Record<string, unknown> = { phase: "failed", completedAt: Date.now() }) {
    ctx.applyOps([{ type: "update_node", id: ctx.node.id, metadata: { status: "error", errorDetails, comfyuiRun: run } }]);
}

function findResultNode(nodes: CanvasNodeData[], sourceNodeId: string, outputId: string, itemIndex: number, promptId: string) {
    return nodes.find((node) => {
        const binding = readComfyResultBinding(node);
        return binding?.sourceNodeId === sourceNodeId && binding.outputId === outputId && binding.itemIndex === itemIndex && node.metadata?.comfyuiPromptId === promptId;
    });
}

function readComfyRun(metadata?: CanvasNodeMetadata) {
    const value = metadata?.comfyuiRun;
    return value && typeof value === "object" ? (value as { phase?: string; promptId?: string }) : null;
}

function readComfySnapshot(metadata?: CanvasNodeMetadata): ComfyCanvasNodeSnapshot | null {
    const value = metadata?.comfyuiLocal;
    if (!value || typeof value !== "object") return null;
    const snapshot = value as Partial<ComfyCanvasNodeSnapshot>;
    return snapshot.workflowId && snapshot.environmentId && Array.isArray(snapshot.inputs) && Array.isArray(snapshot.outputs) && snapshot.values ? (snapshot as ComfyCanvasNodeSnapshot) : null;
}

function extensionForMime(mimeType: string, kind: "image" | "video" | "audio") {
    const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase();
    if (subtype === "jpeg") return "jpg";
    if (subtype === "mpeg") return "mp3";
    if (subtype === "quicktime") return "mov";
    return subtype || (kind === "image" ? "png" : kind === "video" ? "mp4" : "wav");
}

function fallbackMime(kind: "image" | "video" | "audio") {
    return kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/wav";
}
