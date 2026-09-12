import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const choices = {
    1: "windows",
    2: "macos",
    3: "all",
    windows: "windows",
    win: "windows",
    macos: "macos",
    mac: "macos",
    all: "all",
};

const args = process.argv.slice(2);
const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

let target = choices[String(option("--target") || "").toLowerCase()];
if (!target) {
    const prompt = createInterface({ input, output });
    console.log("\nTDCanvas 桌面客户端打包\n");
    console.log("  1. Windows 安装包（NSIS .exe）");
    console.log("  2. macOS 通用安装包（Intel + Apple Silicon .app/.dmg）");
    console.log("  3. Windows + macOS（通过 GitHub Actions 双平台构建）\n");
    target = choices[(await prompt.question("请选择打包目标 [1/2/3]：")).trim().toLowerCase()];
    prompt.close();
}

if (!target) fail("未识别打包目标，请选择 Windows、macOS 或全部。");

const currentPlatform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "unsupported";
const useCi = hasFlag("--ci") || target === "all";
const tauriCli = resolve(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js");

if (useCi) {
    dispatchCi(target);
} else if (target !== currentPlatform) {
    fail(`当前系统不能生成 ${label(target)} 安装包。请在对应系统运行，或追加 --ci 交给双平台构建流程。`);
} else if (target === "windows") {
    const release = updaterReleaseConfig();
    run(process.execPath, [tauriCli, "build", "--bundles", "nsis", "--features", "desktop-updater", "--config", release.config], { env: release.env });
    console.log("\nWindows 安装包与更新签名已生成：src-tauri/target/release/bundle/nsis/\n");
} else {
    const release = updaterReleaseConfig();
    run("rustup", ["target", "add", "aarch64-apple-darwin", "x86_64-apple-darwin"]);
    run(process.execPath, [tauriCli, "build", "--bundles", "app,dmg", "--target", "universal-apple-darwin", "--features", "desktop-updater", "--config", release.config], { env: release.env });
    console.log("\nmacOS 安装包与更新签名已生成：src-tauri/target/universal-apple-darwin/release/bundle/\n");
}

function updaterReleaseConfig() {
    const endpoint = process.env.TDCANVAS_UPDATER_ENDPOINT?.trim();
    const publicKey = process.env.TDCANVAS_UPDATER_PUBLIC_KEY?.trim();
    const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
    const missing = [];
    if (!endpoint) missing.push("TDCANVAS_UPDATER_ENDPOINT");
    if (!publicKey) missing.push("TDCANVAS_UPDATER_PUBLIC_KEY");
    if (!privateKey) missing.push("TAURI_SIGNING_PRIVATE_KEY");
    if (missing.length) {
        fail(`正式安装包必须配置签名更新参数：${missing.join(", ")}。本地无更新能力的测试构建可使用 npm run desktop:build。`);
    }

    const urlForValidation = endpoint.replace(/\{\{(?:target|arch|current_version)\}\}/g, "value");
    try {
        const parsed = new URL(urlForValidation);
        if (parsed.protocol !== "https:") fail("TDCANVAS_UPDATER_ENDPOINT 必须使用 HTTPS。");
    } catch {
        fail("TDCANVAS_UPDATER_ENDPOINT 不是有效的更新地址。");
    }

    return {
        config: JSON.stringify({
            bundle: { createUpdaterArtifacts: true },
            plugins: {
                updater: {
                    pubkey: publicKey,
                    endpoints: [endpoint],
                    windows: { installMode: "passive" },
                },
            },
        }),
        env: { ...process.env, VITE_DESKTOP_UPDATER_ENABLED: "1" },
    };
}

function dispatchCi(selectedTarget) {
    const executable = process.platform === "win32" ? "gh.exe" : "gh";
    const check = spawnSync(executable, ["auth", "status"], { stdio: "ignore" });
    if (check.status !== 0) {
        fail("“全部”需要在 Windows 与 macOS 两台构建机上执行。请安装并登录 GitHub CLI，或在仓库 Actions 页面手动运行“TDCanvas Desktop Package”。");
    }
    run(executable, ["workflow", "run", "desktop-package.yml", "-f", `target=${selectedTarget}`]);
    console.log(`\n已提交 ${label(selectedTarget)} 构建任务。完成后可在 GitHub Actions 下载安装包。\n`);
}

function run(command, commandArgs, options = {}) {
    const result = spawnSync(command, commandArgs, { cwd: process.cwd(), stdio: "inherit", ...options });
    if (result.error) fail(result.error.message);
    if (result.status !== 0) process.exit(result.status || 1);
}

function label(value) {
    if (value === "windows") return "Windows";
    if (value === "macos") return "macOS";
    return "Windows + macOS";
}

function fail(message) {
    console.error(`\n打包未开始：${message}\n`);
    process.exit(1);
}
