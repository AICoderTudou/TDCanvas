# TDCanvas 团队协作指南

## 开始开发

```bash
cd web
npm ci --legacy-peer-deps
npm run typecheck
npm test
```

API Key、下载素材、构建产物和本地 ComfyUI 环境均不得提交。

## 分支约定

- `main`：稳定集成分支，只通过 Pull Request 合并。
- `feature/<topic>`：新功能。
- `fix/<topic>`：缺陷修复。
- `release/<version>`：发布准备。

每项开发从 `main` 创建分支；完成后提交 Pull Request，并在描述中写明用户可见变化和验证方式。

## 提交约定

使用简洁前缀：`feat:`、`fix:`、`refactor:`、`docs:`、`chore:`。一项提交只处理一个清晰目的。

## 合并前检查

至少执行：

```bash
cd web
npm run typecheck
npm test
```

涉及桌面端、ComfyUI 或生成链路时，请补充对应的手动验证说明。
