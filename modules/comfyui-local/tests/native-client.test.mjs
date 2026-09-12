import assert from "node:assert/strict";
import test from "node:test";

import { createComfyNativeClient } from "../dist/frontend/src/index.js";

test("uses the ACL-aligned plugin namespace and only starts native-authorized profiles", async () => {
    const calls = [];
    const client = createComfyNativeClient(async (command, args) => {
        calls.push({ command, args });
        return { ready: true };
    });
    await client.selectEnvironment();
    await client.startEnvironment("env");
    await client.queueWorkflow("env", { 1: { class_type: "SaveImage", inputs: {} } });

    assert.deepEqual(calls, [
        { command: "plugin:tdcanvas-comfyui-local|select_environment", args: undefined },
        { command: "plugin:tdcanvas-comfyui-local|start_environment", args: { profileId: "env" } },
        { command: "plugin:tdcanvas-comfyui-local|queue_workflow", args: { profileId: "env", workflow: { 1: { class_type: "SaveImage", inputs: {} } } } },
    ]);
});
