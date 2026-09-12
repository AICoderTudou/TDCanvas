---
name: open-canvas
description: 启动并打开本地 TDCanvas，自动连接本机 TDCanvas Agent。用户要求打开、启动、进入或使用 TDCanvas 画布时使用。
---

# Open TDCanvas

当前项目使用本地源码开发模式，不使用远程站点或 Docker。

1. 在仓库的 `web` 目录启动前端：

```bash
bun install
bun run dev
```

2. 在仓库的 `canvas-agent` 目录构建并启动本地 Agent：

```bash
npm install
npm run build
node dist/index.js
```

3. 从启动输出取得 `Local URL` 和 `Connect token`，在右侧浏览器打开：

```text
<Vite Local 地址>/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>
```

插件 MCP 使用本地 `tdcanvas-agent mcp` 命令。若命令尚未注册，请先在 `canvas-agent` 目录执行 `npm link`。

用户没有明确指定打开方式时，使用 `mode=new`；只有用户明确要求时才改为 `mode=recent` 或 `mode=choose`。
