# TDCanvas 官方插件注册表

本目录负责一次构建所有内置画布插件，并在本地 `dist/` 生成插件脚本和 `official-plugins.json` 清单。

```text
registry/
  package.json    # 构建依赖
  build.mjs       # 集中构建脚本
  dist/           # 本地产物，不提交到 Git
```

## 本地构建

```bash
cd plugins/canvas/registry
npm install
npm run build
```

构建后可以用任意静态服务器托管 `dist/`，再把前端的插件注册表配置指向本地 `official-plugins.json`。

当前仓库没有预设远程发布地址。等 TDTV 提供正式域名或制品仓库后，再配置发布流程和注册表 URL；不要回退到旧项目的 GitHub、jsDelivr 或其他第三方入口。

新增插件时，在 `build.mjs` 的 `OFFICIAL` 数组中登记目录、名称与说明，并确保插件自身 `package.json` 的版本与源码中的 `definePlugin({ version })` 一致。
