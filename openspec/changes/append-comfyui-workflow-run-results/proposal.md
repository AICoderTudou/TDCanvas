## Why

本地 ComfyUI 工作流目前在重复运行时复用同一个原生结果节点，后一次结果会覆盖前一次已经生成的视频，用户无法在画布上同时比较或继续使用多次运行结果。现有产品需求已提出“同一输出的多次运行进入历史记录”，因此需要把运行结果从“按输出复用”调整为“按运行追加”。

## What Changes

- 本地 ComfyUI 工作流每次成功提交后，为本次 `prompt_id` 分配独立的原生结果节点。
- 第一次运行可以认领工作流随画布创建的空结果节点；后续运行从同一输出端口追加连线和结果节点。
- 新任务的准备、运行、失败、取消和完成状态只影响本次运行的结果节点，不修改既有成功结果。
- 已有画布中带内容和 `comfyuiPromptId` 的结果节点视为历史结果，下一次运行不得复用或覆盖。
- 串行点击运行三次时执行三次，最终保留三条输出连线和三个可独立播放、下载及引用的视频节点。
- 不增加并发任务队列；工作流运行期间继续显示“停止”，下一次运行需等待当前运行结束。

## Capabilities

### New Capabilities

- `comfyui-workflow-run-history`: 规定本地 ComfyUI 工作流按运行追加、隔离和保留原生结果节点的行为。

### Modified Capabilities

无。当前 OpenSpec 尚未建立既有 capability，本次以新 capability 描述该用户可见行为。

## Impact

- 主要影响 `web/src/integrations/comfyui-local/result-nodes.ts` 的结果节点分配 Module，以及 `execution.ts` 的运行级状态和结果写回。
- 调整 `execution.test.ts`、`result-nodes.test.ts`，以运行入口和结果分配 Interface 作为测试 seam。
- 更新 ComfyUI 本地模式产品文档、待验收记录与 `CHANGELOG.md` 中“重复运行复用结果节点”的旧描述。
- 不修改通用画布连接模型、ComfyUI 原生进程模块、远端生成链路或第三方依赖。
