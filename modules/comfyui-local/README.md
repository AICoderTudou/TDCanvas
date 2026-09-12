# TDCanvas ComfyUI Local Module

`modules/comfyui-local` 是「ComfyUI 本地模式」的独立领域模块。它不读取 TDCanvas store，也不依赖 Aitudou 业务；主应用只通过公开 contracts、原生 client 和单一画布 integration 接入。

## 推荐整合包

推荐使用 **土豆 ComfyUI 纯净整合包**，将本地工作流接入 TDCanvas 并封装为画布插件节点。

**[下载纯净整合包（无模型，包含启动器）→](https://pan.quark.cn/s/d96c1eb34170)**

解压后按工作流需要准备模型与自定义节点，在 TDCanvas「ComfyUI 本地」选择 ComfyUI 环境目录并启动，再导入 **API Format JSON** 工作流、选择输入输出并添加到画布。纯净包不包含模型。

## 已完成

### 工作流 contracts 与解析核心

- 校验 ComfyUI API Format JSON，明确拒绝普通 UI workflow JSON
- 合并运行环境的 `/object_info`，扫描内部节点、缺失依赖以及可暴露的输入/输出
- 把用户勾选结果固化为带校验摘要、依赖快照和默认值的宏节点定义
- 为文本、数字、枚举、布尔、图片、视频、音频与 JSON 推导基础控件和端口类型

### Tauri 原生环境管理

- 原生目录选择与已授权环境注册，不接受前端任意路径启动
- 识别 Windows portable/整合包、源码 venv 和系统 Python 布局；兼容 `python`、`python_embeded`、`python_embedded` 及大小写变体
- 只绑定 `127.0.0.1` 随机空闲端口，并强制 `--disable-auto-launch`
- 严格校验额外参数，拒绝覆盖监听地址、端口、目录和 CORS
- 支持启动、状态同步、停止、进程树清理、环形日志、`/system_stats` 与 `/object_info`
- 保存原生进程所有权，下一次启动只回收命令行身份完全匹配的遗留进程

### TDCanvas 集成

- 独立的「ComfyUI 本地」运行环境页面
- 五步导入向导：文件、依赖、输入、输出、预览保存
- 输入选择支持按 ComfyUI 节点 ID 搜索、节点分组、明确选中状态和提示词/媒体入口智能推荐，普通参数保持未选
- 独立工作流库，可保存不可运行草稿并在依赖恢复后重新导入
- 可从本地模式页面或画布一级新增菜单创建节点，绑定工作流后生成携带完整快照的宏节点
- 已创建节点保留独立参数值，可在画布原生下方面板中继续编辑或更换工作流
- 宏节点使用具名、带类型的动态端口；画布按端口持久化连线和路由资源
- 每个已选择输出默认关联一个原生结果节点，图片、视频、音频、文本和文件无需手动补建预览节点
- 支持画布一键提交 `/prompt`、停止队列、轮询 `/history`，并把输入素材上传至当前本地环境
- ComfyUI 文件结果先缓存到 Tauri AppLocalData 的 `comfyui-local/results`，再以稳定桌面地址回填结果节点
- 批量输出会按结果序号补建节点；重复运行复用原节点并替换最新结果

## 当前边界

Phase 0–2 与 Phase 3 的基础执行闭环已完成。当前版本可以安全启动环境、导入工作流、创建带默认结果节点的画布宏节点，并完成提交、停止、结果解析和媒体本地持久化。更细粒度的 WebSocket 内部节点进度与运行历史管理继续作为后续增强，不影响当前生成与结果预览。

运行模块自测：

```bash
npm --prefix modules/comfyui-local run verify
```

产品与架构定义见 [ComfyUI 本地模式 PRD](../../docs/product/comfyui-local-mode-prd.md)。
