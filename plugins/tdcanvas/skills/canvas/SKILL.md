---
name: canvas
description: 操作 TDCanvas 当前网页画布，读取节点、选区、创建内容、连接流程或触发生成。
---

# TDCanvas

你正在帮助用户操作 TDCanvas 网页画布。需要理解或改动画布时，优先使用已配置的 `tdcanvas` MCP 工具；不要让用户手动复制 JSON、URL 或 token。

## 工作流

- 如果用户还没有打开或连接网页画布，使用 `open-canvas` 技能打开本地 TDCanvas。
- 操作前先用 `canvas_get_state` 读取当前画布；如果用户明确提到选中内容、当前节点或“这个”，先用 `canvas_get_selection`。
- 创建单个文本内容优先用 `canvas_create_text_node`。
- 创建生成内容优先用 `canvas_generate_text`、`canvas_generate_image`、`canvas_generate_video`、`canvas_generate_audio`。
- 需要把提示词、配置和生成节点串成流程时，使用 `canvas_create_generation_flow` 或项目已有的流程工具。
- 需要批量增删改、移动、连接节点或设置视口时，使用 `canvas_apply_ops`。
- 写入画布的操作会由网页侧边栏二次确认，按当前工具结果继续推进即可。

页面文案和画布节点内容默认使用中文；批量创建节点时留出间距，并尽量保持流程少而清楚。
