# TDCanvas Codex Plugin

这个本地插件让 Codex 可以打开并操作 TDCanvas，不依赖远程 npm 包或外部 TDCanvas 站点。

## 准备本地 Agent

先在仓库中构建并链接命令：

```bash
cd canvas-agent
npm install
npm run build
npm link
```

## 安装插件

从仓库根目录注册本地 marketplace：

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add tdcanvas@tdcanvas-local
```

Windows PowerShell 将 `$(pwd)` 替换为 `$PWD`。安装后新建 Codex 任务，然后输入“帮我打开并连接到 TDCanvas”。

插件通过本地 `tdcanvas-agent mcp` 命令注册 `tdcanvas` MCP；如果尚未执行 `npm link`，插件不会尝试回退到任何远程包。
