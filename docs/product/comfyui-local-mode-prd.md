# TDCanvas「ComfyUI 本地模式」产品需求文档

> 状态：Phase 0–2 与 Phase 3 基础执行闭环已完成并通过本地验收；实时内部节点进度与运行历史待增强
> 产品形态：Tauri 2 桌面客户端独立功能模块
> 支持平台：Windows、macOS
> 第一版定位：将一个 ComfyUI API 工作流封装为一个可复用、可连接、可配置的 TDCanvas 宏节点

## 1. 背景

TDCanvas 当前主要通过内置模型节点完成图片、视频、音频和文本生成。部分用户已经在本地维护了成熟的 ComfyUI 环境、自定义节点、模型和工作流，但仍需要进入 ComfyUI 浏览器界面修改参数、执行工作流，再手动把结果导回画布。

本功能新增独立的「ComfyUI 本地模式」。用户选择本机 ComfyUI 环境后，由 TDCanvas 在后台启动 ComfyUI 服务，但不打开 ComfyUI 浏览器。用户上传 ComfyUI 的 API JSON，选择希望暴露的输入参数和输出结果，系统自动生成一个 TDCanvas 工作流节点。此后用户可通过画布连线、参数面板和运行按钮使用该工作流。

## 2. 产品目标

1. 用户不需要打开 ComfyUI 浏览器，即可启动、停止和检查本地 ComfyUI 环境。
2. 用户可以导入 ComfyUI API JSON，并可靠识别工作流中的全部节点及其参数定义。
3. 用户可以自由选择需要暴露的输入参数、媒体输入和输出结果。
4. 每个已导入工作流在 TDCanvas 中表现为一个独立的宏节点，而不是复制一套固定 UI。
5. 多个宏节点可以在画布中连接，并复用 TDCanvas 的文本、图片、视频、音频和素材节点。
6. ComfyUI 模块发生启动、解析或执行错误时，不影响 TDCanvas 主画布与 Aitudou 节点。
7. Windows 与 macOS 使用同一份工作流定义和前端交互，仅原生环境发现与进程控制按平台适配。

## 3. 非目标

第一版不包含以下范围：

1. 不把 ComfyUI 内部每个 `MODEL`、`LATENT`、`CONDITIONING` 等运行时节点逐一映射成 TDCanvas 节点。
2. 不内置 ComfyUI、Python、PyTorch、模型或自定义节点的安装器。
3. 不提供 ComfyUI-Manager 的浏览器 UI，也不代替其安装自定义节点。
4. 不编辑 ComfyUI 内部连线拓扑；工作流拓扑以导入的 API JSON 为准。
5. 不支持 ComfyUI 普通 UI 工作流 JSON。用户必须导入“Save (API Format)”产生的 API JSON。
6. 不连接公网 ComfyUI 实例；第一版仅管理本机 `127.0.0.1` 服务。
7. 不在 TDCanvas 中复刻 ComfyUI 的节点编辑器。

## 4. 关键产品决定

### 4.1 一个 API 工作流对应一个 TDCanvas 宏节点

用户导入的整个工作流封装为一个宏节点。工作流内部节点仍完整保存在 JSON 中，用户只选择需要显示在宏节点上的参数和输出。

原因：ComfyUI 的 `MODEL`、`LATENT`、`CONDITIONING` 等对象只存在于单次 Python 执行上下文，不能作为普通文件跨 TDCanvas 节点或跨任务传输。把内部节点强行拆散会改变缓存、执行顺序和自定义节点行为。

后续如需拆分，只支持用户在 ComfyUI 中预先拆成多个可独立执行的 API 工作流，再分别导入为多个宏节点。

### 4.2 API JSON 必须结合运行中的 `/object_info` 解析

API JSON 只保存节点 ID、`class_type`、输入值和内部连线。参数类型、枚举选项、范围、显示名、是否为输出节点及输出类型由当前 ComfyUI 环境的 `/object_info` 提供。

因此：

- 离线时可以读取 JSON 和展示原始节点列表，但不能完成可靠的参数映射。
- 保存宏节点前必须连接目标 ComfyUI 环境并完成依赖校验。
- 同一 JSON 在不同 ComfyUI 环境中可能产生不同的参数定义和依赖结果。

### 4.3 主项目只增加通用端口能力

当前 TDCanvas 连线只记录 `fromNodeId` 和 `toNodeId`，每个节点只有一个通用输入和输出。ComfyUI 宏节点需要多个有名称、有类型的输入和输出端口。

主画布需要新增与供应商无关的通用能力：

- `CanvasConnection.fromPortId?`
- `CanvasConnection.toPortId?`
- 节点定义可声明多个输入/输出端口
- 端口包含 `id`、名称、方向、资源类型、是否必填、是否允许多连接
- 连线时执行通用类型兼容校验
- 旧节点不声明端口时继续使用默认单输入/单输出

主画布不得出现 `comfyuiWorkflowId`、`comfyNodeId` 等 ComfyUI 专有字段。ComfyUI 模块通过通用插件端口协议接入。

## 5. 用户角色与典型场景

### 5.1 ComfyUI 工作流作者

已经在本地调通工作流，希望把常用参数暴露给 TDCanvas，而不重复进入 ComfyUI 修改。

### 5.2 画布创作者

不了解 ComfyUI 内部结构，只需要给宏节点连接参考图、输入提示词、调整少量参数并获得结果。

### 5.3 多环境用户

Windows 上可能同时拥有便携版和源码版 ComfyUI；macOS 上可能拥有多个虚拟环境。需要明确选择并保存环境配置。

## 6. 信息架构

### 6.1 模式入口

TDCanvas 顶部工作区增加模式切换入口：

- `AI 画布`
- `ComfyUI 本地模式`

进入 ComfyUI 本地模式后加载独立路由和独立状态，不改变现有 Aitudou 配置与画布节点。

建议路由：

- `/comfyui-local`：环境与工作流库
- `/comfyui-local/canvas/:id`：ComfyUI 本地模式画布

### 6.2 模块页面

ComfyUI 本地模式包含三块：

1. 环境状态：环境路径、Python 解释器、端口、运行状态、设备信息、启动日志。
2. 工作流库：已导入工作流、版本、依赖状态、最近运行结果。
3. 画布：创建和连接 ComfyUI 宏节点、编辑参数、运行及查看结果。

## 7. 核心用户流程

### 7.1 首次进入与启动环境

1. 用户进入「ComfyUI 本地模式」。
2. 如果没有环境配置，显示环境引导，不直接进入空画布。
3. 用户选择 ComfyUI 目录。
4. 模块自动识别安装类型与候选 Python：
   - Windows 便携版/整合包：`python_embeded/python.exe`、`python_embedded/python.exe` 或 `python/python.exe` + `ComfyUI/main.py`；已知目录名按大小写无关方式匹配
   - Windows/macOS 源码版：根目录 `main.py` + `.venv`/`venv` 中的 Python
   - 无法唯一识别时，要求用户选择 Python 可执行文件
5. 校验 `main.py`、Python 可执行文件及目录权限。
6. 自动选择空闲端口，默认仅监听 `127.0.0.1`。
7. 使用参数数组启动：`main.py --listen 127.0.0.1 --port <port> --disable-auto-launch`。
8. 不打开浏览器。
9. 轮询 `/system_stats`，成功后获取 `/object_info`。
10. 状态变为“运行中”，显示 Python、PyTorch、设备和显存信息。

用户可手动停止、重启、打开日志。TDCanvas 只停止由自己启动的 ComfyUI 子进程。

### 7.2 导入 API 工作流

采用五步向导：

#### 第一步：选择文件

- 支持点击选择和拖拽 `.json`。
- 判断是否为 API Format。
- 普通 UI workflow JSON 必须明确提示如何重新导出，不能尝试猜测转换。

#### 第二步：依赖检查

- 读取所有节点 ID、`class_type`、输入和内部连接。
- 与 `/object_info` 对照。
- 展示节点总数、内置节点数、自定义节点数、缺失节点数。
- 缺少任意 `class_type` 时不允许保存为可运行节点，但允许保存草稿。
- 显示缺失的类名和可能对应的 Python 模块，不自动安装。

#### 第三步：选择输入

按 ComfyUI 内部节点分组展示可暴露项：

- 节点 ID与显示名称
- 参数名称与类型
- API JSON 当前值
- ComfyUI 默认值、范围、步进、枚举
- “暴露为节点参数”勾选项
- 对外显示名称
- 控件形式
- 是否必填
- 是否显示为画布输入端口

默认只推荐可安全修改的字面量输入。内部连线值（如 `["4", 0]`）默认锁定，不作为普通参数。

第一版控件映射：

| ComfyUI 定义 | TDCanvas 控件 |
| --- | --- |
| `STRING` | 单行输入或多行文本框 |
| `INT` | 数字输入；有范围时可选滑块 |
| `FLOAT` | 数字输入；保留步进与精度 |
| `BOOLEAN` | 开关 |
| 枚举数组 | 下拉选择 |
| 图片加载节点的文件字段 | 图片输入端口 + 上传/素材选择 |
| 视频/音频加载节点的文件字段 | 对应媒体输入端口 |
| 未知字面量 | 高级 JSON 输入，默认不推荐 |

参数值优先级：画布连线输入 > 当前宏节点手动值 > API JSON 原始值。

#### 第四步：选择输出

根据 `/object_info.output_node`、输出类型和执行历史结构列出可选输出：

- 图片
- 视频/GIF
- 音频
- 文本
- 文件
- 原始 JSON

`MODEL`、`LATENT`、`CONDITIONING` 等内存对象不能作为 TDCanvas 输出端口。

每个输出可设置：

- 显示名称
- 资源类型
- 对应 ComfyUI 节点 ID
- 输出字段或结果选择规则
- 是否在宏节点中显示预览
- 是否创建画布输出端口

无法识别的自定义节点输出只能选择“原始 JSON”，并提示无法直接连接图片/视频节点，除非用户配置结果字段映射。

#### 第五步：节点预览与保存

- 输入节点名称、分类和说明。
- 预览宏节点的端口、参数布局与输出区域。
- 保存到工作流库。
- 可选择“保存并添加到当前画布”。

### 7.3 在画布中运行

1. 用户添加一个已导入的 ComfyUI 宏节点。
2. 用户设置参数或连接上游文本、图片、视频、音频节点。
3. 点击运行。
4. 模块复制工作流 JSON，不修改库中原始快照。
5. 将暴露参数写入对应 `nodeId.inputs.field`。
6. 对本地媒体输入先调用 `/upload/image` 或对应上传流程，再写入 ComfyUI 文件定位值。
7. `POST /prompt` 提交任务并保存 `prompt_id`。
8. 使用 `/ws?clientId=...` 接收排队、执行节点、进度、完成与错误事件。
9. WebSocket 异常时自动通过 `/history/{prompt_id}` 轮询兜底。
10. 完成后读取所选输出，下载并缓存到 TDCanvas 应用数据目录。
11. 宏节点显示最新结果、运行状态和运行历史；所选输出端口可继续连接下游节点。

## 8. 宏节点交互

### 8.1 默认状态

- 标题：用户保存的工作流名称
- 副标题：环境名称与工作流版本
- 中部：用户选择暴露的参数
- 左侧：有名称和类型的输入端口
- 右侧：有名称和类型的输出端口
- 底部：运行、停止、状态、耗时、打开日志

### 8.2 运行状态

- `未运行`
- `等待 ComfyUI`
- `排队中`
- `运行中`
- `成功`
- `失败`
- `已取消`
- `环境已断开`

运行时显示当前 ComfyUI 内部节点名称和总体进度。没有可靠总进度时显示阶段状态，不伪造百分比。

### 8.3 结果预览

- 多输出使用紧凑标签切换，不遮挡主要预览。
- 同一输出的多次运行进入历史记录。
- 图片、视频、音频沿用 TDCanvas 现有查看、下载、裁剪和素材保存能力。
- 输出文件先缓存到本地，再向画布下游提供稳定地址。

## 9. 工作流库

每条工作流包含：

- 名称、说明、分类
- 原始 API JSON 快照
- 工作流内容哈希
- 绑定环境 ID
- ComfyUI 节点清单
- 暴露输入定义
- 暴露输出定义
- 依赖校验结果
- 创建时间、更新时间
- 最近一次运行状态

支持：

- 添加到画布
- 编辑参数暴露
- 重新校验依赖
- 用新 API JSON 更新工作流
- 复制工作流定义
- 删除

更新 JSON 时先生成差异报告。节点 ID、`class_type` 或已暴露字段消失时，必须要求用户重新映射，不静默覆盖。

## 10. 独立模块架构

建议目录：

```text
modules/comfyui-local/
  contracts/             # 与主项目通信的数据协议，无 React/Tauri 依赖
  core/                  # API JSON 解析、schema 合并、参数映射、任务状态机
  frontend/              # 环境页、导入向导、工作流库、宏节点 UI
  tauri-plugin/          # 环境检测、进程管理、本地 HTTP/WS、文件缓存
  fixtures/              # 官方与自定义节点测试工作流
  README.md

web/src/integrations/comfyui-local/
  index.ts               # 唯一宿主接入点：注册路由、模式入口和通用画布节点
```

模块边界：

```text
TDCanvas Host
  ├─ 通用画布端口协议
  ├─ 模式/路由注册接口
  └─ Tauri 插件注册
          │
          ▼
ComfyUI Local Module
  ├─ 环境与进程
  ├─ Workflow Parser
  ├─ ComfyUI Client
  ├─ Workflow Library
  └─ Macro Canvas Node
          │
          ▼
Local ComfyUI Process (127.0.0.1, random port)
```

隔离要求：

1. 模块使用自己的 store、持久化 namespace、事件 namespace 和错误边界。
2. 主项目不直接 import 模块内部文件，只通过 `index.ts` 与 contracts 接入。
3. ComfyUI 网络请求由 Tauri 原生模块发起，不依赖 Vite proxy 或 WebView CORS。
4. 子进程崩溃只改变环境状态，不使 Tauri 主进程退出。
5. 模块禁用时不注册路由、节点类型、定时器或事件监听。
6. 所有清理函数必须在退出模式、禁用模块和应用退出时执行。

## 11. 核心数据结构

```ts
type ComfyEnvironmentProfile = {
  id: string;
  name: string;
  rootDirectory: string;
  mainPyPath: string;
  pythonPath: string;
  installKind: "windows-portable" | "source-venv" | "source-system-python";
  extraArgs: string[];
  lastPort?: number;
  lastVerifiedAt?: string;
};

type ComfyExposedInput = {
  id: string;
  nodeId: string;
  field: string;
  label: string;
  valueType: "string" | "integer" | "number" | "boolean" | "enum" | "image" | "video" | "audio" | "json";
  control: "text" | "textarea" | "number" | "slider" | "switch" | "select" | "media" | "json";
  defaultValue: unknown;
  required: boolean;
  canvasPort: boolean;
  constraints?: Record<string, unknown>;
};

type ComfyExposedOutput = {
  id: string;
  nodeId: string;
  outputIndex?: number;
  resultField?: string;
  label: string;
  resourceType: "image" | "video" | "audio" | "text" | "file" | "json";
  canvasPort: boolean;
  preview: boolean;
};

type ComfyWorkflowDefinition = {
  id: string;
  name: string;
  description?: string;
  environmentId: string;
  apiWorkflow: Record<string, ComfyApiNode>;
  workflowHash: string;
  inputs: ComfyExposedInput[];
  outputs: ComfyExposedOutput[];
  dependencySnapshot: ComfyDependencySnapshot;
  createdAt: string;
  updatedAt: string;
};
```

业务列表和工作流定义使用模块独立的 localForage namespace；输出媒体、日志和大文件写入 Tauri Application Support/AppLocalData 下的 `comfyui-local` 子目录。

## 12. 原生进程与网络要求

1. 进程启动必须使用 executable + args 数组，禁止拼接 shell 字符串。
2. 默认监听 `127.0.0.1`，禁止默认使用 `0.0.0.0`。
3. 自动寻找空闲端口，避免强占 8188 或连接到未知 ComfyUI 实例。
4. 必须添加 `--disable-auto-launch`，即使 Windows 便携版参数隐式开启浏览器也要覆盖。
5. 启动超时默认 120 秒，可在日志中继续观察，不将慢启动误判为永久失败。
6. 捕获 stdout/stderr，保留最近日志并支持导出。
7. 应用正常退出时终止由 TDCanvas 启动的子进程；异常退出后下次启动检查遗留 PID 与端口，但不得误杀非 TDCanvas 进程。
8. 环境路径和 Python 路径通过原生文件选择器授权。
9. 不启用 CORS，不开放局域网访问，不在 URL 中传递本地文件路径。

## 13. ComfyUI API 使用范围

第一版使用官方本地服务接口：

- `GET /system_stats`：环境与设备检测
- `GET /object_info`：全部节点类型、输入与输出 schema
- `GET /object_info/{node_class}`：单节点刷新
- `POST /upload/image`：上传图片输入
- `POST /prompt`：验证并提交工作流
- `GET /queue`：队列状态
- `POST /queue`：删除排队任务
- `POST /interrupt`：中断当前任务
- `GET /history/{prompt_id}`：状态与最终结果
- `GET /view`：读取 ComfyUI 输出文件
- `WS /ws?clientId=...`：实时执行事件

官方资料：

- [ComfyUI 本地服务路由](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [ComfyUI WebSocket 消息](https://docs.comfy.org/development/comfyui-server/comms_messages)
- [ComfyUI 官方 WebSocket API 示例](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py)
- [ComfyUI `object_info` 实现](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)
- [ComfyUI 启动参数定义](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/cli_args.py)

## 14. 错误处理

| 场景 | 用户反馈 | 是否允许继续 |
| --- | --- | --- |
| 目录不是 ComfyUI | 指出缺少的文件 | 否 |
| 找不到 Python | 要求选择 Python 可执行文件 | 否 |
| 端口占用 | 自动换端口并记录 | 是 |
| 启动失败 | 展示退出码与日志尾部 | 否 |
| `/object_info` 超时 | 提示可能由自定义节点加载过慢，可重试 | 仅保存草稿 |
| API JSON 格式错误 | 显示 JSON 路径和原因 | 否 |
| 导入的是 UI workflow | 提示使用 Save (API Format) | 否 |
| 缺少自定义节点 | 列出 `class_type` | 仅保存草稿 |
| 参数 schema 与 JSON 不一致 | 标记冲突并要求手动映射 | 否 |
| 输入媒体上传失败 | 标明具体输入端口 | 否 |
| `/prompt` 校验失败 | 展示 `node_errors` 对应内部节点 | 否 |
| WebSocket 断开 | 自动轮询 history | 是 |
| ComfyUI 进程退出 | 所有运行节点变为环境已断开 | 可重启后重试 |
| 输出字段无法识别 | 保留原始 JSON 供重新映射 | 部分成功 |

## 15. 性能要求

1. 解析 500 个内部节点的 API JSON 应在 1 秒内完成，不包含 ComfyUI schema 请求。
2. `/object_info` 按环境和本次进程缓存，避免每次打开向导重新请求。
3. 工作流运行时只克隆当前 JSON，不在画布状态中复制模型或二进制媒体。
4. 日志使用环形缓冲，默认最多保留 10,000 行或 10 MB。
5. 大输出通过流式写盘，不转为 base64 放入 React/Zustand 状态。
6. WebSocket 使用单环境共享连接，按 `prompt_id` 分发事件。

## 16. 安全要求

1. 只启动用户明确选择目录中的 `main.py` 和 Python。
2. 导入 JSON 只作为数据解析，不执行其中的字符串或脚本。
3. 不自动执行工作流，导入完成后必须由用户点击运行。
4. 不自动安装 requirements、自定义节点或模型。
5. 自定义启动参数采用受控数组；危险或会开放网络的参数需要明确警告。
6. ComfyUI 服务只绑定 loopback。
7. 读取和写入路径限制在用户选定的 ComfyUI 环境与 TDCanvas 模块数据目录。
8. 输出文件进入 TDCanvas 前记录来源、工作流 ID、`prompt_id` 和 ComfyUI 文件定位信息。

## 17. MVP 验收标准

### 17.1 环境

- Windows 便携版可被识别、启动、停止，不弹出浏览器。
- Windows 源码 + venv 可被识别、启动、停止。
- macOS 源码 + venv 可被识别、启动、停止。
- 路径错误、Python 错误、启动失败均有可理解的中文提示。

### 17.2 导入

- 能导入官方基础文生图 API JSON。
- 能读取全部内部节点并与 `/object_info` 对齐。
- 能识别缺失自定义节点并阻止误运行。
- 能暴露提示词、seed、steps、cfg、尺寸、checkpoint 枚举。
- 能配置至少一个图片输入和一个图片输出。

### 17.3 画布

- 能从工作流库创建宏节点。
- 宏节点支持多个具名输入与输出端口。
- 文本节点和上传图片节点可连接到正确输入端口。
- 运行状态、当前内部节点和错误可追踪。
- 成功结果自动缓存到本地，并能连接到下游图片节点。
- 多次运行保留历史且不额外创建重复的宏节点。
- 停止运行不会关闭 TDCanvas，也不会影响 Aitudou 节点。

### 17.4 隔离

- 禁用 ComfyUI 模块后，主画布仍能正常打开、保存和运行。
- ComfyUI 进程崩溃不会导致 Tauri 主进程退出。
- 不选择环境、不导入工作流时，模块不启动后台进程。
- 模块存储损坏时只重置模块数据，不清空主画布。

## 18. 开发阶段

### Phase 0：平台契约

状态：已完成

- 通用多端口节点与连接数据结构
- 插件端口声明、类型兼容和资源读取协议
- 旧节点默认端口兼容
- ComfyUI 模块 contracts 与测试 fixture

### Phase 1：环境与进程

状态：已完成

- 独立 Tauri plugin
- Windows/macOS 环境检测
- 后台启动、停止、日志、健康检查
- `/system_stats` 与 `/object_info` 客户端

### Phase 2：工作流导入

状态：已完成

- API JSON 校验与 parser
- schema 合并和依赖扫描
- 五步导入向导
- 工作流库与版本更新

### Phase 3：宏节点执行

状态：基础闭环完成；宏节点、参数编辑、多端口连线、真实执行、停止、结果回传与本地缓存已交付

- 动态宏节点
- 参数编辑和多端口连线
- 媒体上传、workflow patch、`POST /prompt`
- `/history` 完成态轮询、错误回传和取消
- 按暴露输出默认创建并复用原生图片、视频、音频或文本结果节点
- 结果映射和本地缓存

后续增强：WebSocket 内部节点进度、可视化队列详情和多次运行历史。

### Phase 4：稳定性与双平台交付

- 自定义节点兼容 fixture
- 异常退出与进程回收
- Windows 安装包、macOS `.app/.dmg`
- 性能、错误提示和端到端验收

## 19. 需求审查结论

### 19.1 已解决的歧义

1. “工作流变成画布节点”定义为：一个 API 工作流对应一个 TDCanvas 宏节点。
2. “读取所有节点”定义为：读取内部全部节点用于参数和依赖选择，但不把内部运行时节点逐个显示到 TDCanvas。
3. “自由控制”通过可选择字面量参数、媒体参数、多输入/多输出端口和高级 JSON 映射实现。
4. “独立模块”定义为独立 contracts、core、frontend、Tauri plugin、store 和错误边界；主项目只提供通用端口与模式注册能力。
5. “选择 ComfyUI 目录环境”包含 ComfyUI 根目录和 Python 解释器识别；无法唯一识别时由用户补选解释器。

### 19.2 仍需在开发验收时确认、但不阻塞开工的偏好

1. 模式入口最终使用顶部文字切换还是首页独立入口。
2. 宏节点参数默认直接展开多少项，超过多少项折叠到参数面板。
3. 是否在后续版本支持连接一个已经由用户手动启动的本地 ComfyUI。

默认方案：顶部模式切换；宏节点直接展示最多 6 个常用参数，其余进入展开面板；第一版只管理 TDCanvas 自己启动的 ComfyUI。

### 19.3 审查结果

需求在采用上述边界后可实施，没有阻塞开发的问题。最大的平台改动是通用多端口协议，必须先于 ComfyUI 宏节点完成。开发应从 Phase 0 开始，不应先写导入 UI 再反向修改画布连接模型。
