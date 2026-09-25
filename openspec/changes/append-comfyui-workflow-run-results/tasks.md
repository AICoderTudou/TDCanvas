## 1. 结果分配 Module 的 TDD 切片

- [x] 1.1 在 `result-nodes.test.ts` 通过 `ensureComfyResultNodeOps(...)` seam 添加 RED 测试：已有成功结果时，新 `promptId` 必须产生一个新结果节点和一条新连线；运行该单测并确认修改实现前按预期失败
- [x] 1.2 扩展结果分配 Interface 接受 `{ promptId, itemIndexes }`，实现按本次运行查找、认领无内容空节点及拒绝复用历史节点的最小逻辑；运行 `result-nodes.test.ts` 并确认 1.1 转为 GREEN
- [x] 1.3 添加 RED 测试覆盖现有非空无 `comfyuiPromptId` 结果、用户已删除历史结果后再运行和同一 `promptId` 重复协调；按测试逐项补足最小 Implementation，并确认每个切片转为 GREEN
- [x] 1.4 添加 RED 测试覆盖多输出与批量条目的追加顺序和节点边界不重叠；实现基于受管结果实际最大底边的追加布局，并确认 `result-nodes.test.ts` 全部通过

## 2. 工作流执行入口的 TDD 切片

- [x] 2.1 将 `execution.test.ts` 的“重复运行复用节点”测试改为 RED 验收测试：模拟三个不同 `promptId` 和三个不同视频路径，断言三次串行运行后存在三个视频节点、三条连线，且前两次结果未被修改；运行该单测并确认当前实现失败
- [x] 2.2 调整 `runComfyWorkflowNode(ctx)`：提交前只标记源节点，取得 `promptId` 后分配本次结果，完成时仅按 `promptId + outputId + itemIndex` 写回；运行 `execution.test.ts` 并确认三次运行测试转为 GREEN
- [x] 2.3 添加 RED 测试证明新运行在提交前失败时不创建结果且不改变历史成功节点；补足最小错误处理并确认测试转为 GREEN
- [x] 2.4 添加 RED 测试证明提交后失败和用户取消只改变当前 `promptId` 的占位结果，历史成功节点内容、路径、状态及运行标识不变；补足最小状态隔离并确认测试转为 GREEN
- [x] 2.5 添加 RED 测试覆盖一次运行返回多个输出条目以及缺失输出只影响当前运行；补足当前运行范围内的批量补建与缺失标记并确认 `execution.test.ts` 全部通过

## 3. 回归与文档

- [x] 3.1 运行 ComfyUI 本地集成相关测试，验证工作流创建、暴露输出重选、结果资源解析、停止及输入上传未回归
- [x] 3.2 更新 `docs/product/comfyui-local-mode-prd.md`，将“重复运行复用原结果节点”改为按运行追加历史结果，并核对新描述与 capability spec 一致
- [x] 3.3 按项目规范检查并更新 `docs/content/docs/progress/todo.mdx`、`todo.zh-CN.mdx`、`pending-test.mdx`、`pending-test.zh-CN.mdx`；以文件差异验证只记录本功能相关待办或待验收项
- [x] 3.4 在 `CHANGELOG.md` 的 `Unreleased` 增加一条中文 `[新增]` 或 `[调整]` 记录，并验证未改动其他版本记录

## 4. 审查与自动验证

- [x] 4.1 以当前基线 `22f46ba` 和本变更 OpenSpec artifacts 为依据运行 `code-review` 的 Standards/Spec 双轴审查；因禁止提交，审查工作区差异并记录两轴发现，修复阻塞验收的问题后复查
- [x] 4.2 运行完整测试套件并确认全部通过；如发现与本变更无关的既有失败，记录准确测试名称和证据，不扩大修改范围
- [x] 4.3 运行 TypeScript 类型检查并确认零错误
- [x] 4.4 执行正式生产前端和 Tauri 构建，核验产物版本、路径、大小和 SHA-256；不得提交、推送或创建 PR

## 5. 真实 AITudou 画布验收

- [x] 5.1 在不关闭用户既有浏览器窗口或标签页的前提下打开独立验收画布，使用真实本地 ComfyUI 单视频工作流完成第一次运行，验证一条输出连线和一个可播放视频节点
- [x] 5.2 等待每次完成后再运行两次，验证总计执行三次、形成三条连线和三个可播放且路径不同的视频节点，并通过节点信息确认三个 `comfyuiPromptId` 不同
- [x] 5.3 在第三次结果完成后重新检查前两个节点的内容、本地路径、成功状态和运行标识，确认与各自首次完成时一致且媒体文件仍可访问
- [x] 5.4 汇总真实画布证据、自动验证结果、代码审查结果和产物信息交付用户审核；保持所有改动未提交、未推送且无 PR
