# TDCanvas 客户端自动更新

TDCanvas 使用 Tauri 2 官方 Updater 完成完整客户端更新。客户端启动时检查一次；发现新版本后由用户下载，下载完成后点击“重启并更新”。画布、本地素材、API Key 与 ComfyUI 配置不属于安装包更新内容，不应被覆盖。

## 发布前配置

首次配置时，在 `web` 目录生成更新签名密钥：

```powershell
npm run tauri signer generate -- -w C:\secure\tdcanvas-updater.key
```

私钥必须存放在密码管理器或 CI Secret 中，不能提交到 Git。生成出的公钥需要内置到正式客户端。

正式打包需要以下环境变量：

```text
TDCANVAS_UPDATER_ENDPOINT=https://api.example.com/desktop/update/{{target}}/{{arch}}/{{current_version}}
TDCANVAS_UPDATER_PUBLIC_KEY=<签名公钥内容>
TAURI_SIGNING_PRIVATE_KEY=<私钥内容或私钥文件路径>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<私钥密码，可为空>
```

GitHub Actions 使用同名 Repository Secrets。`npm run desktop:package` 会拒绝在缺少必要签名配置时生成正式安装包；不带更新能力的本地测试构建仍可使用 `npm run desktop:build`。

## aitudou-web 接口

客户端请求地址支持 Tauri 的 `{{target}}`、`{{arch}}` 与 `{{current_version}}` 占位符。没有更新时返回：

```http
HTTP/1.1 204 No Content
```

有更新时返回：

```json
{
  "version": "0.15.0",
  "pub_date": "2026-09-01T12:00:00Z",
  "url": "https://cdn.example.com/tdcanvas/0.15.0/TDCanvas-update.zip",
  "signature": "<对应 .sig 文件的完整文本内容>",
  "notes": "本次更新说明"
}
```

要求：

- `version` 必须是高于当前版本的 SemVer。
- `url` 指向当前操作系统和架构对应的更新产物，不是普通安装包下载页。
- `signature` 是 `.sig` 文件的文本内容，不能填写 `.sig` 的 URL。
- 更新产物建议放在对象存储/CDN，接口只负责版本选择。
- 更新发布必须先上传产物和签名，确认 CDN 可访问后再发布接口记录。

## 构建产物

开启更新签名后，Windows 构建会额外生成 updater 压缩包和 `.sig`；macOS 构建会生成 `.app.tar.gz` 和 `.sig`。GitHub Actions 已包含这些文件的上传规则。

发布前至少完成以下验证：

1. 使用旧版本客户端检查更新。
2. 验证版本号、更新说明和下载进度。
3. 下载完成后点击“重启并更新”。
4. 验证新版本号以及原有画布、本地素材和配置仍然存在。
5. 用错误签名做一次测试，确认客户端拒绝安装。
