use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Runtime, State,
    plugin::{Builder, TauriPlugin},
};
use tauri_plugin_dialog::DialogExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    process::{Child, Command},
};

const PLUGIN_NAME: &str = "tdcanvas-comfyui-local";
const LOOPBACK_HOST: &str = "127.0.0.1";
const STARTUP_ATTEMPTS: usize = 240;
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_LOG_LINES: usize = 10_000;
const MAX_LOG_BYTES: usize = 10 * 1024 * 1024;
const EXECUTION_POLL_INTERVAL: Duration = Duration::from_millis(500);
const EXECUTION_TIMEOUT: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_UPLOAD_BYTES: usize = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ComfyInstallKind {
    WindowsPortable,
    SourceVenv,
    SourceSystemPython,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyEnvironmentProfile {
    pub id: String,
    pub name: String,
    pub root_directory: String,
    pub main_py_path: String,
    pub python_path: String,
    pub install_kind: ComfyInstallKind,
    #[serde(default)]
    pub extra_args: Vec<String>,
    pub last_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentDetection {
    pub profile: Option<ComfyEnvironmentProfile>,
    pub selected_root: String,
    pub python_candidates: Vec<String>,
    pub issues: Vec<String>,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EnvironmentPhase {
    Idle,
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentStatus {
    pub phase: EnvironmentPhase,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub started_at: Option<u64>,
    pub message: Option<String>,
    pub profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentLogEntry {
    pub timestamp: u64,
    pub stream: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub status: EnvironmentStatus,
    pub executable: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedInput {
    name: String,
    subfolder: Option<String>,
    #[serde(rename = "type")]
    file_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedPrompt {
    prompt_id: String,
    queue_number: Option<u64>,
    node_errors: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestedOutput {
    id: String,
    node_id: String,
    result_field: Option<String>,
    label: String,
    resource_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionOutput {
    output_id: String,
    node_id: String,
    item_index: usize,
    resource_type: String,
    label: String,
    filename: Option<String>,
    mime_type: Option<String>,
    absolute_path: Option<String>,
    bytes: Option<u64>,
    text: Option<String>,
    raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    prompt_id: String,
    outputs: Vec<ExecutionOutput>,
    completed_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedEnvironments {
    pub profiles: Vec<ComfyEnvironmentProfile>,
    pub active_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SavedEnvironmentFile {
    profiles: Vec<ComfyEnvironmentProfile>,
    active_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessOwnership {
    pid: u32,
    port: u16,
    profile_id: String,
    main_py_path: String,
    started_at: u64,
}

struct EnvironmentRegistryInner {
    profiles: HashMap<String, ComfyEnvironmentProfile>,
    active_profile_id: Option<String>,
    pending_root: Option<PathBuf>,
}

pub struct EnvironmentRegistry {
    inner: Mutex<EnvironmentRegistryInner>,
    storage_path: PathBuf,
}

impl EnvironmentRegistry {
    fn load(storage_path: PathBuf) -> Result<Self, String> {
        let saved = match fs::read(&storage_path) {
            Ok(bytes) => serde_json::from_slice::<SavedEnvironmentFile>(&bytes)
                .map_err(|error| format!("无法读取已保存的 ComfyUI 环境：{error}"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                SavedEnvironmentFile::default()
            }
            Err(error) => return Err(format!("无法读取 ComfyUI 环境配置：{error}")),
        };
        Ok(Self {
            inner: Mutex::new(EnvironmentRegistryInner {
                profiles: saved
                    .profiles
                    .into_iter()
                    .map(normalize_profile_paths)
                    .map(|profile| (profile.id.clone(), profile))
                    .collect(),
                active_profile_id: saved.active_profile_id,
                pending_root: None,
            }),
            storage_path,
        })
    }

    fn snapshot(&self) -> Result<SavedEnvironments, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "ComfyUI 环境配置不可用".to_owned())?;
        let mut profiles = inner.profiles.values().cloned().collect::<Vec<_>>();
        profiles.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        Ok(SavedEnvironments {
            profiles,
            active_profile_id: inner.active_profile_id.clone(),
        })
    }

    fn profile(&self, profile_id: &str) -> Result<ComfyEnvironmentProfile, String> {
        self.inner
            .lock()
            .map_err(|_| "ComfyUI 环境配置不可用".to_owned())?
            .profiles
            .get(profile_id)
            .cloned()
            .ok_or_else(|| "该 ComfyUI 环境未经过本机授权，请重新选择目录".to_owned())
    }

    fn authorize(&self, profile: ComfyEnvironmentProfile) -> Result<(), String> {
        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "ComfyUI 环境配置不可用".to_owned())?;
            inner.active_profile_id = Some(profile.id.clone());
            inner.profiles.insert(profile.id.clone(), profile);
            inner.pending_root = None;
        }
        self.persist()
    }

    fn set_pending_root(&self, root: PathBuf) -> Result<(), String> {
        self.inner
            .lock()
            .map_err(|_| "ComfyUI 环境配置不可用".to_owned())?
            .pending_root = Some(root);
        Ok(())
    }

    fn pending_root(&self) -> Result<PathBuf, String> {
        self.inner
            .lock()
            .map_err(|_| "ComfyUI 环境配置不可用".to_owned())?
            .pending_root
            .clone()
            .ok_or_else(|| "请先通过目录选择器选择 ComfyUI 环境".to_owned())
    }

    fn remove(&self, profile_id: &str) -> Result<SavedEnvironments, String> {
        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "ComfyUI 环境配置不可用".to_owned())?;
            inner.profiles.remove(profile_id);
            if inner.active_profile_id.as_deref() == Some(profile_id) {
                inner.active_profile_id = None;
            }
        }
        self.persist()?;
        self.snapshot()
    }

    fn persist(&self) -> Result<(), String> {
        let saved = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "ComfyUI 环境配置不可用".to_owned())?;
            SavedEnvironmentFile {
                profiles: inner.profiles.values().cloned().collect(),
                active_profile_id: inner.active_profile_id.clone(),
            }
        };
        if let Some(parent) = self.storage_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建 ComfyUI 配置目录：{error}"))?;
        }
        let bytes = serde_json::to_vec_pretty(&saved)
            .map_err(|error| format!("无法保存 ComfyUI 环境：{error}"))?;
        let temporary = self.storage_path.with_extension("tmp");
        fs::write(&temporary, bytes).map_err(|error| format!("无法写入 ComfyUI 环境：{error}"))?;
        if self.storage_path.exists() {
            fs::remove_file(&self.storage_path)
                .map_err(|error| format!("无法更新 ComfyUI 环境配置：{error}"))?;
        }
        fs::rename(&temporary, &self.storage_path)
            .map_err(|error| format!("无法提交 ComfyUI 环境配置：{error}"))
    }
}

struct ProcessInner {
    child: Option<Child>,
    phase: EnvironmentPhase,
    pid: Option<u32>,
    port: Option<u16>,
    started_at: Option<u64>,
    message: Option<String>,
    profile_id: Option<String>,
    generation: u64,
    log_bytes: usize,
    logs: VecDeque<EnvironmentLogEntry>,
}

impl Default for ProcessInner {
    fn default() -> Self {
        Self {
            child: None,
            phase: EnvironmentPhase::Idle,
            pid: None,
            port: None,
            started_at: None,
            message: None,
            profile_id: None,
            generation: 0,
            log_bytes: 0,
            logs: VecDeque::new(),
        }
    }
}

pub struct ComfyProcessManager {
    inner: Mutex<ProcessInner>,
    lifecycle: tokio::sync::Mutex<()>,
    accepting_starts: AtomicBool,
    ownership_path: PathBuf,
}

impl ComfyProcessManager {
    fn new(ownership_path: PathBuf) -> Self {
        Self {
            inner: Mutex::new(ProcessInner::default()),
            lifecycle: tokio::sync::Mutex::new(()),
            accepting_starts: AtomicBool::new(true),
            ownership_path,
        }
    }

    fn snapshot(&self) -> EnvironmentStatus {
        let inner = self.inner.lock().expect("ComfyUI process state poisoned");
        snapshot(&inner)
    }

    fn terminate_now(&self) {
        self.accepting_starts.store(false, Ordering::Release);
        let child = {
            let mut inner = self.inner.lock().expect("ComfyUI process state poisoned");
            inner.generation = inner.generation.wrapping_add(1);
            inner.phase = EnvironmentPhase::Stopped;
            inner.pid = None;
            inner.port = None;
            inner.message = None;
            inner.child.take()
        };
        if let Some(mut child) = child {
            terminate_process_tree_sync(child.id());
            let _ = child.start_kill();
        }
        let _ = fs::remove_file(&self.ownership_path);
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, _api| {
            let storage_directory = app.path().app_local_data_dir()?.join("comfyui-local");
            fs::create_dir_all(&storage_directory)?;
            let ownership_path = storage_directory.join("process-ownership.json");
            reclaim_stale_owned_process(&ownership_path);
            app.manage(EnvironmentRegistry::load(
                storage_directory.join("environments.json"),
            )?);
            app.manage(ComfyProcessManager::new(ownership_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_environment,
            select_environment_python,
            saved_environments,
            remove_environment,
            start_environment,
            stop_environment,
            environment_status,
            environment_logs,
            system_stats,
            object_info,
            upload_input,
            queue_workflow,
            wait_for_execution,
            interrupt_execution,
        ])
        .on_event(|app, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                if let Some(state) = app.try_state::<ComfyProcessManager>() {
                    state.terminate_now();
                }
            }
        })
        .on_drop(|app| {
            if let Some(state) = app.try_state::<ComfyProcessManager>() {
                state.terminate_now();
            }
        })
        .build()
}

#[tauri::command]
async fn select_environment<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, EnvironmentRegistry>,
) -> Result<Option<EnvironmentDetection>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("选择 ComfyUI 目录")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|error| format!("无法读取所选目录：{error}"))?;
    let detection = detect_environment_at(&selected, None)?;
    registry.set_pending_root(PathBuf::from(&detection.selected_root))?;
    if let Some(profile) = detection.profile.clone().filter(|_| detection.ready) {
        registry.authorize(profile)?;
    }
    Ok(Some(detection))
}

#[tauri::command]
async fn select_environment_python<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, EnvironmentRegistry>,
) -> Result<Option<EnvironmentDetection>, String> {
    let root = registry.pending_root()?;
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("选择该 ComfyUI 环境使用的 Python")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|error| format!("无法读取所选 Python：{error}"))?;
    let detection = detect_environment_at(&root, Some(&selected))?;
    if let Some(profile) = detection.profile.clone().filter(|_| detection.ready) {
        registry.authorize(profile)?;
    }
    Ok(Some(detection))
}

#[tauri::command]
fn saved_environments(
    registry: State<'_, EnvironmentRegistry>,
) -> Result<SavedEnvironments, String> {
    registry.snapshot()
}

#[tauri::command]
fn remove_environment(
    registry: State<'_, EnvironmentRegistry>,
    process: State<'_, ComfyProcessManager>,
    profile_id: String,
) -> Result<SavedEnvironments, String> {
    let status = process.snapshot();
    if status.profile_id.as_deref() == Some(profile_id.as_str())
        && matches!(
            status.phase,
            EnvironmentPhase::Starting | EnvironmentPhase::Running
        )
    {
        return Err("请先停止当前 ComfyUI 环境".to_owned());
    }
    registry.remove(&profile_id)
}

#[tauri::command]
async fn start_environment<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ComfyProcessManager>,
    registry: State<'_, EnvironmentRegistry>,
    profile_id: String,
) -> Result<LaunchResult, String> {
    let _lifecycle = state.lifecycle.lock().await;
    if !state.accepting_starts.load(Ordering::Acquire) {
        return Err("TDCanvas 正在退出，不能再启动 ComfyUI".to_owned());
    }
    let profile = registry.profile(&profile_id)?;
    let launch = build_launch_spec(&profile)?;
    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "ComfyUI 进程状态不可用".to_owned())?;
        if let Some(child) = inner.child.as_mut() {
            if child
                .try_wait()
                .map_err(|error| format!("无法读取 ComfyUI 进程状态：{error}"))?
                .is_none()
            {
                return Err("ComfyUI 已由 TDCanvas 启动，请先停止或重启当前环境".to_owned());
            }
        }
        inner.child = None;
    }

    let mut command = Command::new(&launch.executable);
    command
        .args(&launch.args)
        .current_dir(&launch.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000 | 0x00000200);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 ComfyUI：{error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child
        .id()
        .ok_or_else(|| "无法读取 ComfyUI 进程 ID".to_owned())?;
    if !state.accepting_starts.load(Ordering::Acquire) {
        terminate_process_tree(&mut child, Some(pid)).await;
        return Err("TDCanvas 正在退出，已取消启动 ComfyUI".to_owned());
    }
    let started_at = now_millis();
    let ownership = ProcessOwnership {
        pid,
        port: launch.port,
        profile_id: profile.id.clone(),
        main_py_path: profile.main_py_path.clone(),
        started_at,
    };
    if let Err(error) = write_process_ownership(&state.ownership_path, &ownership) {
        terminate_process_tree(&mut child, Some(pid)).await;
        return Err(error);
    }
    let generation = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "ComfyUI 进程状态不可用".to_owned())?;
        inner.generation = inner.generation.wrapping_add(1);
        inner.phase = EnvironmentPhase::Starting;
        inner.pid = Some(pid);
        inner.port = Some(launch.port);
        inner.started_at = Some(started_at);
        inner.message = Some("正在等待 ComfyUI 完成自定义节点加载".to_owned());
        inner.profile_id = Some(profile.id.clone());
        inner.logs.clear();
        inner.log_bytes = 0;
        inner.child = Some(child);
        inner.generation
    };

    if let Some(stream) = stdout {
        tauri::async_runtime::spawn(collect_logs(app.clone(), "stdout", stream, generation));
    }
    if let Some(stream) = stderr {
        tauri::async_runtime::spawn(collect_logs(app.clone(), "stderr", stream, generation));
    }
    tauri::async_runtime::spawn(monitor_startup(app.clone(), generation, launch.port));

    let status = state.snapshot();
    let _ = app.emit("comfyui-local://status", &status);
    Ok(LaunchResult {
        status,
        executable: launch.executable.to_string_lossy().into_owned(),
        args: launch
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect(),
    })
}

#[tauri::command]
async fn stop_environment(
    state: State<'_, ComfyProcessManager>,
) -> Result<EnvironmentStatus, String> {
    let _lifecycle = state.lifecycle.lock().await;
    let child = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "ComfyUI 进程状态不可用".to_owned())?;
        inner.generation = inner.generation.wrapping_add(1);
        inner.phase = EnvironmentPhase::Stopped;
        inner.pid = None;
        inner.port = None;
        inner.started_at = None;
        inner.message = None;
        inner.profile_id = None;
        inner.child.take()
    };
    if let Some(mut child) = child {
        let pid = child.id();
        terminate_process_tree(&mut child, pid).await;
    }
    let _ = fs::remove_file(&state.ownership_path);
    Ok(state.snapshot())
}

#[tauri::command]
async fn environment_status(
    state: State<'_, ComfyProcessManager>,
) -> Result<EnvironmentStatus, String> {
    let (status, exited) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "ComfyUI 进程状态不可用".to_owned())?;
        let mut exited = false;
        if let Some(child) = inner.child.as_mut() {
            if let Some(status) = child
                .try_wait()
                .map_err(|error| format!("无法读取 ComfyUI 进程状态：{error}"))?
            {
                inner.child = None;
                inner.phase = EnvironmentPhase::Failed;
                inner.pid = None;
                inner.port = None;
                inner.message = Some(format!("ComfyUI 进程已退出：{status}"));
                exited = true;
            }
        }
        (snapshot(&inner), exited)
    };
    if exited {
        let _ = fs::remove_file(&state.ownership_path);
    }
    if status.phase == EnvironmentPhase::Starting {
        if let Some(port) = status.port {
            if local_comfy_ready(port).await {
                let mut inner = state
                    .inner
                    .lock()
                    .map_err(|_| "ComfyUI 进程状态不可用".to_owned())?;
                if inner.phase == EnvironmentPhase::Starting && inner.port == Some(port) {
                    inner.phase = EnvironmentPhase::Running;
                    inner.message = None;
                    return Ok(snapshot(&inner));
                }
            }
        }
    }
    Ok(status)
}

#[tauri::command]
fn environment_logs(
    state: State<'_, ComfyProcessManager>,
) -> Result<Vec<EnvironmentLogEntry>, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "ComfyUI 进程状态不可用".to_owned())?;
    Ok(inner.logs.iter().cloned().collect())
}

#[tauri::command]
async fn system_stats(state: State<'_, ComfyProcessManager>) -> Result<Value, String> {
    fetch_local_json(&state, "/system_stats").await
}

#[tauri::command]
async fn object_info(state: State<'_, ComfyProcessManager>) -> Result<Value, String> {
    fetch_local_json(&state, "/object_info").await
}

#[tauri::command]
async fn upload_input(
    state: State<'_, ComfyProcessManager>,
    profile_id: String,
    filename: String,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<UploadedInput, String> {
    let port = running_profile_port(&state, &profile_id)?;
    if bytes.is_empty() {
        return Err("上传到 ComfyUI 的素材为空".to_owned());
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err("上传到 ComfyUI 的单个素材不能超过 1 GB".to_owned());
    }
    let filename = sanitize_result_filename(&filename, "tdcanvas-input.bin");
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str(mime_type.trim())
        .map_err(|error| format!("素材 MIME 类型无效：{error}"))?;
    let form = reqwest::multipart::Form::new()
        .part("image", part)
        .text("type", "input")
        .text("overwrite", "true");
    let response = local_http_client(Duration::from_secs(30))?
        .post(format!("http://{LOOPBACK_HOST}:{port}/upload/image"))
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("无法上传素材到 ComfyUI：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取 ComfyUI 上传响应：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "ComfyUI 素材上传失败（HTTP {}）：{}",
            status.as_u16(),
            compact_error(&body)
        ));
    }
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("ComfyUI 上传响应不是有效 JSON：{error}"))?;
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "ComfyUI 上传响应缺少文件名".to_owned())?;
    Ok(UploadedInput {
        name: name.to_owned(),
        subfolder: value
            .get("subfolder")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .filter(|value| !value.is_empty()),
        file_type: value
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .filter(|value| !value.is_empty()),
    })
}

#[tauri::command]
async fn queue_workflow(
    state: State<'_, ComfyProcessManager>,
    profile_id: String,
    workflow: Value,
) -> Result<QueuedPrompt, String> {
    let port = running_profile_port(&state, &profile_id)?;
    let payload = serde_json::json!({
        "prompt": workflow,
        "client_id": format!("tdcanvas-{}-{}", std::process::id(), now_millis()),
    });
    let response = local_http_client(Duration::from_secs(30))?
        .post(format!("http://{LOOPBACK_HOST}:{port}/prompt"))
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("无法提交 ComfyUI 工作流：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取 ComfyUI 提交响应：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "ComfyUI 拒绝了工作流（HTTP {}）：{}",
            status.as_u16(),
            compact_error(&body)
        ));
    }
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("ComfyUI 提交响应不是有效 JSON：{error}"))?;
    let prompt_id = value
        .get("prompt_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("ComfyUI 未返回 prompt_id：{}", compact_error(&body)))?;
    Ok(QueuedPrompt {
        prompt_id: prompt_id.to_owned(),
        queue_number: value.get("number").and_then(Value::as_u64).or_else(|| {
            value
                .get("number")
                .and_then(Value::as_f64)
                .map(|number| number as u64)
        }),
        node_errors: value
            .get("node_errors")
            .cloned()
            .filter(|value| value.as_object().is_some_and(|items| !items.is_empty())),
    })
}

#[tauri::command]
async fn wait_for_execution<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ComfyProcessManager>,
    registry: State<'_, EnvironmentRegistry>,
    profile_id: String,
    prompt_id: String,
    outputs: Vec<RequestedOutput>,
    output_folder: String,
) -> Result<ExecutionResult, String> {
    let profile = registry.profile(&profile_id)?;
    let comfy_root = PathBuf::from(profile.root_directory);
    let started = Instant::now();
    loop {
        let port = running_profile_port(&state, &profile_id)?;
        let history = local_http_client(Duration::from_secs(30))?
            .get(format!("http://{LOOPBACK_HOST}:{port}/history/{prompt_id}"))
            .send()
            .await
            .map_err(|error| format!("无法查询 ComfyUI 运行结果：{error}"))?
            .error_for_status()
            .map_err(|error| format!("ComfyUI 历史接口返回错误：{error}"))?
            .json::<Value>()
            .await
            .map_err(|error| format!("无法读取 ComfyUI 运行结果：{error}"))?;
        if let Some(entry) = history.get(&prompt_id) {
            if execution_failed(entry) {
                return Err(execution_error(entry));
            }
            let completed = entry
                .pointer("/status/completed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let node_outputs = entry.get("outputs").and_then(Value::as_object);
            if completed || node_outputs.is_some_and(|items| !items.is_empty()) {
                let mapped =
                    collect_execution_outputs(
                        &app,
                        port,
                        &prompt_id,
                        node_outputs,
                        &outputs,
                        &comfy_root,
                        &output_folder,
                    )
                    .await?;
                return Ok(ExecutionResult {
                    prompt_id,
                    outputs: mapped,
                    completed_at: now_millis(),
                });
            }
        }
        if started.elapsed() >= EXECUTION_TIMEOUT {
            return Err("ComfyUI 工作流运行超过 12 小时，已停止等待结果".to_owned());
        }
        tokio::time::sleep(EXECUTION_POLL_INTERVAL).await;
    }
}

#[tauri::command]
async fn interrupt_execution(
    state: State<'_, ComfyProcessManager>,
    profile_id: String,
    prompt_id: String,
) -> Result<(), String> {
    let port = running_profile_port(&state, &profile_id)?;
    let client = local_http_client(Duration::from_secs(15))?;
    let queue_result = client
        .post(format!("http://{LOOPBACK_HOST}:{port}/queue"))
        .json(&serde_json::json!({ "delete": [prompt_id] }))
        .send()
        .await;
    let interrupt_result = client
        .post(format!("http://{LOOPBACK_HOST}:{port}/interrupt"))
        .json(&serde_json::json!({}))
        .send()
        .await;
    if queue_result.is_err() && interrupt_result.is_err() {
        return Err("无法向 ComfyUI 发送停止指令".to_owned());
    }
    Ok(())
}

fn running_profile_port(state: &ComfyProcessManager, profile_id: &str) -> Result<u16, String> {
    let status = state.snapshot();
    if status.phase != EnvironmentPhase::Running {
        return Err("ComfyUI 环境尚未运行，请先在 ComfyUI 本地模式中启动环境".to_owned());
    }
    if status.profile_id.as_deref() != Some(profile_id) {
        return Err("当前运行的 ComfyUI 环境与该工作流绑定环境不一致".to_owned());
    }
    status
        .port
        .ok_or_else(|| "ComfyUI 运行端口不可用".to_owned())
}

fn local_http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("无法创建 ComfyUI 本地请求：{error}"))
}

fn execution_failed(entry: &Value) -> bool {
    entry
        .pointer("/status/status_str")
        .and_then(Value::as_str)
        .is_some_and(|value| value.eq_ignore_ascii_case("error"))
        || entry
            .pointer("/status/messages")
            .and_then(Value::as_array)
            .is_some_and(|messages| {
                messages.iter().any(|message| {
                    message.get(0).and_then(Value::as_str) == Some("execution_error")
                })
            })
}

fn execution_error(entry: &Value) -> String {
    let detail = entry
        .pointer("/status/messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message.get(0).and_then(Value::as_str) == Some("execution_error"))
        })
        .and_then(|message| message.get(1))
        .map(Value::to_string)
        .unwrap_or_else(|| "未知执行错误".to_owned());
    format!("ComfyUI 工作流执行失败：{}", compact_error(&detail))
}

async fn collect_execution_outputs<R: Runtime>(
    app: &AppHandle<R>,
    port: u16,
    prompt_id: &str,
    node_outputs: Option<&serde_json::Map<String, Value>>,
    requested: &[RequestedOutput],
    comfy_root: &Path,
    output_folder: &str,
) -> Result<Vec<ExecutionOutput>, String> {
    let mut results = Vec::new();
    for request in requested {
        let Some(node_result) = node_outputs.and_then(|items| items.get(&request.node_id)) else {
            continue;
        };
        if request.resource_type == "json" {
            results.push(ExecutionOutput {
                output_id: request.id.clone(),
                node_id: request.node_id.clone(),
                item_index: 0,
                resource_type: request.resource_type.clone(),
                label: request.label.clone(),
                filename: None,
                mime_type: Some("application/json".to_owned()),
                absolute_path: None,
                bytes: None,
                text: None,
                raw: Some(node_result.clone()),
            });
            continue;
        }
        let selected = select_result_value(node_result, request);
        let Some(selected) = selected else { continue };
        let items: Vec<&Value> = selected
            .as_array()
            .map(|values| values.iter().collect())
            .unwrap_or_else(|| vec![selected]);
        for (item_index, item) in items.into_iter().enumerate() {
            if let Some(filename) = item.get("filename").and_then(Value::as_str).or_else(|| {
                (request.resource_type == "file")
                    .then(|| item.as_str())
                    .flatten()
            }) {
                let fallback_descriptor;
                let descriptor = if item.is_object() {
                    item
                } else {
                    fallback_descriptor =
                        serde_json::json!({ "filename": filename, "type": "output" });
                    &fallback_descriptor
                };
                let cached =
                    cache_comfy_output(
                        app,
                        port,
                        prompt_id,
                        request,
                        item_index,
                        descriptor,
                        comfy_root,
                        output_folder,
                    )
                    .await?;
                results.push(cached);
            } else if request.resource_type == "text" {
                let text = item
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| item.to_string());
                results.push(ExecutionOutput {
                    output_id: request.id.clone(),
                    node_id: request.node_id.clone(),
                    item_index,
                    resource_type: request.resource_type.clone(),
                    label: request.label.clone(),
                    filename: None,
                    mime_type: Some("text/plain".to_owned()),
                    absolute_path: None,
                    bytes: Some(text.len() as u64),
                    text: Some(text),
                    raw: None,
                });
            } else {
                results.push(ExecutionOutput {
                    output_id: request.id.clone(),
                    node_id: request.node_id.clone(),
                    item_index,
                    resource_type: request.resource_type.clone(),
                    label: request.label.clone(),
                    filename: None,
                    mime_type: Some("application/json".to_owned()),
                    absolute_path: None,
                    bytes: None,
                    text: None,
                    raw: Some(item.clone()),
                });
            }
        }
    }
    Ok(results)
}

fn select_result_value<'a>(node_result: &'a Value, request: &RequestedOutput) -> Option<&'a Value> {
    let object = node_result.as_object()?;
    if let Some(field) = request.result_field.as_deref()
        && let Some(value) = object.get(field)
    {
        return Some(value);
    }
    let fields: &[&str] = match request.resource_type.as_str() {
        "image" => &["images"],
        "video" => &["videos", "gifs", "images"],
        "audio" => &["audio", "audios"],
        "text" => &["text", "texts", "string"],
        "file" => &["files", "filenames", "images", "videos", "audio"],
        _ => &[],
    };
    fields
        .iter()
        .find_map(|field| object.get(*field))
        .or(Some(node_result))
}

async fn cache_comfy_output<R: Runtime>(
    app: &AppHandle<R>,
    port: u16,
    prompt_id: &str,
    request: &RequestedOutput,
    item_index: usize,
    descriptor: &Value,
    comfy_root: &Path,
    output_folder: &str,
) -> Result<ExecutionOutput, String> {
    let filename = descriptor
        .get("filename")
        .and_then(Value::as_str)
        .ok_or_else(|| "ComfyUI 输出缺少文件名".to_owned())?;
    let subfolder = descriptor
        .get("subfolder")
        .and_then(Value::as_str)
        .unwrap_or("");
    let file_type = descriptor
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("output");
    let fallback = format!(
        "{}-{}-result.bin",
        sanitize_path_segment(&request.id, "output"),
        item_index + 1
    );
    let safe_filename = sanitize_result_filename(filename, &fallback);
    let directory = if request.resource_type == "video" {
        video_output_directory(comfy_root, output_folder)
    } else {
        app.path()
            .app_local_data_dir()
            .map_err(|error| format!("无法定位 TDCanvas 本地数据目录：{error}"))?
            .join("comfyui-local")
            .join("results")
            .join(sanitize_path_segment(prompt_id, "prompt"))
    };
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("无法创建 ComfyUI 结果目录：{error}"))?;
    if request.resource_type == "video" {
        app.asset_protocol_scope()
            .allow_directory(&directory, true)
            .map_err(|error| format!("无法授权 ComfyUI 视频预览目录：{error}"))?;
    }
    let direct_target = directory.join(&safe_filename);
    let source = (request.resource_type == "video")
        .then(|| comfy_result_source_path(comfy_root, file_type, subfolder, &safe_filename))
        .flatten();
    let target = if source.as_ref() == Some(&direct_target) {
        direct_target
    } else {
        unique_result_path(&directory, &safe_filename, item_index)
    };
    let response_mime = if target.exists() {
        None
    } else if let Some(source) = source.filter(|path| path.exists()) {
        tokio::fs::rename(&source, &target)
            .await
            .map_err(|error| format!("无法将 ComfyUI 视频移动到画布输出目录：{error}"))?;
        None
    } else {
        let mut url = reqwest::Url::parse(&format!("http://{LOOPBACK_HOST}:{port}/view"))
            .map_err(|error| format!("无法创建 ComfyUI 输出地址：{error}"))?;
        url.query_pairs_mut()
            .append_pair("filename", filename)
            .append_pair("subfolder", subfolder)
            .append_pair("type", file_type);
        let response = local_http_client(Duration::from_secs(30 * 60))?
            .get(url)
            .send()
            .await
            .map_err(|error| format!("无法下载 ComfyUI 输出 {filename}：{error}"))?
            .error_for_status()
            .map_err(|error| format!("ComfyUI 输出下载失败 {filename}：{error}"))?;
        let response_mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.split(';').next().unwrap_or(value).trim().to_owned());
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("无法读取 ComfyUI 输出 {filename}：{error}"))?;
        if bytes.is_empty() {
            return Err(format!("ComfyUI 输出 {filename} 为空"));
        }
        tokio::fs::write(&target, &bytes)
            .await
            .map_err(|error| format!("无法保存 ComfyUI 输出：{error}"))?;
        response_mime
    };
    let bytes = tokio::fs::metadata(&target)
        .await
        .map_err(|error| format!("无法读取 ComfyUI 输出文件信息：{error}"))?
        .len();
    let mime_type = response_mime.or_else(|| mime_from_filename(&safe_filename).map(str::to_owned));
    Ok(ExecutionOutput {
        output_id: request.id.clone(),
        node_id: request.node_id.clone(),
        item_index,
        resource_type: request.resource_type.clone(),
        label: request.label.clone(),
        filename: Some(safe_filename),
        mime_type,
        absolute_path: Some(target.to_string_lossy().into_owned()),
        bytes: Some(bytes),
        text: None,
        raw: None,
    })
}

fn video_output_directory(comfy_root: &Path, output_folder: &str) -> PathBuf {
    comfy_root
        .join("output")
        .join(sanitize_result_filename(output_folder, "TDCanvas"))
}

fn comfy_result_source_path(
    comfy_root: &Path,
    file_type: &str,
    subfolder: &str,
    filename: &str,
) -> Option<PathBuf> {
    let base = match file_type {
        "output" => comfy_root.join("output"),
        "temp" => comfy_root.join("temp"),
        _ => return None,
    };
    let subfolder = Path::new(subfolder);
    if subfolder
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(base.join(subfolder).join(filename))
}

fn sanitize_result_filename(value: &str, fallback: &str) -> String {
    let name = Path::new(value)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback);
    let sanitized: String = name
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let sanitized = sanitized.trim_matches([' ', '.']);
    if sanitized.is_empty() {
        fallback.to_owned()
    } else {
        sanitized.chars().take(180).collect()
    }
}

fn sanitize_path_segment(value: &str, fallback: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        fallback.to_owned()
    } else {
        sanitized.chars().take(96).collect()
    }
}

fn unique_result_path(directory: &Path, filename: &str, item_index: usize) -> PathBuf {
    let path = directory.join(filename);
    if !path.exists() {
        return path;
    }
    let source = Path::new(filename);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("result");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    directory.join(format!("{stem}-{}-{item_index}{extension}", now_millis()))
}

fn mime_from_filename(filename: &str) -> Option<&'static str> {
    match Path::new(filename)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "flac" => Some("audio/flac"),
        "ogg" => Some("audio/ogg"),
        "m4a" => Some("audio/mp4"),
        "txt" => Some("text/plain"),
        "json" => Some("application/json"),
        _ => None,
    }
}

fn compact_error(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(800).collect()
}

async fn fetch_local_json(state: &ComfyProcessManager, path: &str) -> Result<Value, String> {
    let port = state
        .snapshot()
        .port
        .ok_or_else(|| "ComfyUI 尚未启动".to_owned())?;
    let url = format!("http://{LOOPBACK_HOST}:{port}{path}");
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("无法创建 ComfyUI 本地请求：{error}"))?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("无法连接 ComfyUI：{error}"))?
        .error_for_status()
        .map_err(|error| format!("ComfyUI 返回错误：{error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("无法读取 ComfyUI JSON：{error}"))
}

async fn monitor_startup<R: Runtime>(app: AppHandle<R>, generation: u64, port: u16) {
    for _ in 0..STARTUP_ATTEMPTS {
        let should_continue = {
            let state = app.state::<ComfyProcessManager>();
            let mut inner = match state.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            if inner.generation != generation || inner.phase != EnvironmentPhase::Starting {
                return;
            }
            if let Some(child) = inner.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        inner.child = None;
                        inner.phase = EnvironmentPhase::Failed;
                        inner.pid = None;
                        inner.message = Some(format!("ComfyUI 启动期间退出：{status}"));
                        let status = snapshot(&inner);
                        drop(inner);
                        let _ = fs::remove_file(&state.ownership_path);
                        let _ = app.emit("comfyui-local://status", status);
                        return;
                    }
                    Ok(None) => true,
                    Err(_) => false,
                }
            } else {
                false
            }
        };
        if !should_continue {
            return;
        }
        if local_comfy_ready(port).await {
            let status = {
                let state = app.state::<ComfyProcessManager>();
                let mut inner = match state.inner.lock() {
                    Ok(inner) => inner,
                    Err(_) => return,
                };
                if inner.generation != generation || inner.phase != EnvironmentPhase::Starting {
                    return;
                }
                inner.phase = EnvironmentPhase::Running;
                inner.message = None;
                snapshot(&inner)
            };
            let _ = app.emit("comfyui-local://status", status);
            return;
        }
        tokio::time::sleep(STARTUP_POLL_INTERVAL).await;
    }

    let status = {
        let state = app.state::<ComfyProcessManager>();
        let mut inner = match state.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        if inner.generation != generation || inner.phase != EnvironmentPhase::Starting {
            return;
        }
        inner.message =
            Some("ComfyUI 启动时间较长，进程仍在运行；可继续查看日志或手动重试检测".to_owned());
        snapshot(&inner)
    };
    let _ = app.emit("comfyui-local://status", status);
}

async fn local_comfy_ready(port: u16) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    else {
        return false;
    };
    client
        .get(format!("http://{LOOPBACK_HOST}:{port}/system_stats"))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

async fn collect_logs<R: Runtime, S: AsyncRead + Unpin>(
    app: AppHandle<R>,
    stream_name: &'static str,
    stream: S,
    generation: u64,
) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let entry = EnvironmentLogEntry {
            timestamp: now_millis(),
            stream: stream_name.to_owned(),
            message: line,
        };
        {
            let state = app.state::<ComfyProcessManager>();
            let mut inner = match state.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            if inner.generation != generation {
                return;
            }
            inner.log_bytes += entry.message.len();
            inner.logs.push_back(entry.clone());
            while inner.logs.len() > MAX_LOG_LINES || inner.log_bytes > MAX_LOG_BYTES {
                if let Some(removed) = inner.logs.pop_front() {
                    inner.log_bytes = inner.log_bytes.saturating_sub(removed.message.len());
                } else {
                    break;
                }
            }
        }
        let _ = app.emit("comfyui-local://log", entry);
    }
}

struct LaunchSpec {
    executable: PathBuf,
    working_directory: PathBuf,
    args: Vec<OsString>,
    port: u16,
}

fn build_launch_spec(profile: &ComfyEnvironmentProfile) -> Result<LaunchSpec, String> {
    let root = canonical_directory(Path::new(&profile.root_directory), "ComfyUI 目录")?;
    let main_py = canonical_file(Path::new(&profile.main_py_path), "ComfyUI main.py")?;
    if !main_py.starts_with(&root) {
        return Err("main.py 必须位于用户选择的 ComfyUI 目录中".to_owned());
    }
    let python = normalize_executable_path(Path::new(&profile.python_path), "Python 解释器")?;
    validate_extra_args(&profile.extra_args)?;
    let port = find_available_port()?;
    let mut args = vec![
        main_py.as_os_str().to_owned(),
        OsString::from("--listen"),
        OsString::from(LOOPBACK_HOST),
        OsString::from("--port"),
        OsString::from(port.to_string()),
        OsString::from("--disable-auto-launch"),
    ];
    args.extend(profile.extra_args.iter().map(OsString::from));
    Ok(LaunchSpec {
        executable: python,
        working_directory: main_py.parent().unwrap_or(&root).to_path_buf(),
        args,
        port,
    })
}

fn validate_extra_args(args: &[String]) -> Result<(), String> {
    const SAFE_FLAGS: &[&str] = &[
        "--lowvram",
        "--novram",
        "--cpu",
        "--force-fp16",
        "--force-fp32",
        "--disable-smart-memory",
        "--dont-upcast-attention",
        "--use-split-cross-attention",
        "--use-quad-cross-attention",
    ];
    for arg in args {
        let normalized = arg.trim().to_ascii_lowercase();
        if !SAFE_FLAGS.contains(&normalized.as_str()) {
            return Err(format!("启动参数 {arg} 未列入 TDCanvas 本地安全白名单"));
        }
    }
    Ok(())
}

fn find_available_port() -> Result<u16, String> {
    TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("无法分配本地 ComfyUI 端口：{error}"))
}

fn detect_environment_at(
    root: &Path,
    explicit_python: Option<&Path>,
) -> Result<EnvironmentDetection, String> {
    let root = canonical_directory(root, "ComfyUI 目录")?;
    let portable_main =
        find_path_case_insensitive(&root, &["ComfyUI", "main.py"]).filter(|path| path.is_file());
    let source_main = find_path_case_insensitive(&root, &["main.py"]).filter(|path| path.is_file());
    let (main_py, portable_main_layout) = if let Some(main_py) = portable_main {
        (main_py, true)
    } else if let Some(main_py) = source_main {
        (main_py, false)
    } else {
        return Err(
            "所选目录中没有找到 main.py；请选择 ComfyUI 根目录或 Windows 便携版根目录".to_owned(),
        );
    };

    let mut python_search_roots = vec![root.clone()];
    if root
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("ComfyUI"))
        && let Some(parent) = root.parent()
    {
        python_search_roots.push(parent.to_path_buf());
    }

    let mut portable_candidates = Vec::<PathBuf>::new();
    for search_root in &python_search_roots {
        for directory in ["python_embeded", "python_embedded", "python"] {
            if let Some(path) =
                find_path_case_insensitive(search_root, &[directory, windows_python_name()])
                && path.is_file()
            {
                portable_candidates.push(path);
            }
        }
    }

    let mut venv_candidate_paths = Vec::<PathBuf>::new();
    for directory in [".venv", "venv"] {
        let path = root.join(directory).join(venv_python_relative());
        if path.is_file() {
            venv_candidate_paths.push(path);
        }
    }

    let mut candidates = Vec::<PathBuf>::new();
    let mut normalized_portable_candidates = Vec::<PathBuf>::new();
    let mut normalized_venv_candidates = Vec::<PathBuf>::new();
    for (path, kind) in portable_candidates
        .into_iter()
        .map(|path| (path, ComfyInstallKind::WindowsPortable))
        .chain(
            venv_candidate_paths
                .into_iter()
                .map(|path| (path, ComfyInstallKind::SourceVenv)),
        )
    {
        let executable = normalize_executable_path(&path, "Python 解释器")?;
        if kind == ComfyInstallKind::WindowsPortable
            && !normalized_portable_candidates.contains(&executable)
        {
            normalized_portable_candidates.push(executable.clone());
        }
        if kind == ComfyInstallKind::SourceVenv && !normalized_venv_candidates.contains(&executable)
        {
            normalized_venv_candidates.push(executable.clone());
        }
        if !candidates.contains(&executable) {
            candidates.push(executable);
        }
    }
    let selected_python = match explicit_python {
        Some(path) => Some(normalize_executable_path(path, "Python 解释器")?),
        None => candidates.first().cloned(),
    };
    if let Some(selected) = &selected_python {
        if !candidates.contains(selected) {
            candidates.insert(0, selected.clone());
        }
    }

    let mut issues = Vec::new();
    if selected_python.is_none() {
        issues.push(
            "未找到可用 Python，请手动选择该 ComfyUI 环境使用的 Python 可执行文件".to_owned(),
        );
    }
    let main_py = canonical_file(&main_py, "ComfyUI main.py")?;
    let profile = selected_python.map(|python| {
        let install_kind =
            if portable_main_layout || normalized_portable_candidates.contains(&python) {
                ComfyInstallKind::WindowsPortable
            } else if normalized_venv_candidates.contains(&python) {
                ComfyInstallKind::SourceVenv
            } else {
                ComfyInstallKind::SourceSystemPython
            };
        let id = format!("comfy-{:016x}", stable_path_hash(&root, &python));
        ComfyEnvironmentProfile {
            id,
            name: root
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("ComfyUI")
                .to_owned(),
            root_directory: root.to_string_lossy().into_owned(),
            main_py_path: main_py.to_string_lossy().into_owned(),
            python_path: python.to_string_lossy().into_owned(),
            install_kind,
            extra_args: Vec::new(),
            last_port: None,
        }
    });
    Ok(EnvironmentDetection {
        selected_root: root.to_string_lossy().into_owned(),
        ready: profile.is_some() && issues.is_empty(),
        profile,
        python_candidates: candidates
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        issues,
    })
}

fn find_path_case_insensitive(root: &Path, segments: &[&str]) -> Option<PathBuf> {
    let mut current = root.to_path_buf();
    for segment in segments {
        let exact = current.join(segment);
        if exact.exists() {
            current = exact;
            continue;
        }
        current = fs::read_dir(&current)
            .ok()?
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(segment)
            })?
            .path();
    }
    Some(current)
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err(format!("{label}不存在或不是目录"));
    }
    path.canonicalize()
        .map(normalize_windows_path)
        .map_err(|error| format!("无法读取{label}：{error}"))
}

fn canonical_file(path: &Path, label: &str) -> Result<PathBuf, String> {
    if !path.is_file() {
        return Err(format!("{label}不存在或不可访问"));
    }
    path.canonicalize()
        .map(normalize_windows_path)
        .map_err(|error| format!("无法读取{label}：{error}"))
}

fn normalize_executable_path(path: &Path, label: &str) -> Result<PathBuf, String> {
    if !path.is_file() {
        return Err(format!("{label}不存在或不可访问"));
    }
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("无法定位当前目录：{error}"))?
            .join(path)
    };
    let parent = absolute
        .parent()
        .ok_or_else(|| format!("{label}路径无效"))?;
    let file_name = absolute
        .file_name()
        .ok_or_else(|| format!("{label}路径无效"))?;
    Ok(normalize_windows_path(
        parent
            .canonicalize()
            .map_err(|error| format!("无法读取{label}目录：{error}"))?,
    )
    .join(file_name))
}

fn normalize_profile_paths(mut profile: ComfyEnvironmentProfile) -> ComfyEnvironmentProfile {
    profile.root_directory = normalize_windows_path(PathBuf::from(profile.root_directory))
        .to_string_lossy()
        .into_owned();
    profile.main_py_path = normalize_windows_path(PathBuf::from(profile.main_py_path))
        .to_string_lossy()
        .into_owned();
    profile.python_path = normalize_windows_path(PathBuf::from(profile.python_path))
        .to_string_lossy()
        .into_owned();
    profile
}

#[cfg(target_os = "windows")]
fn normalize_windows_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

#[cfg(not(target_os = "windows"))]
fn normalize_windows_path(path: PathBuf) -> PathBuf {
    path
}

#[cfg(target_os = "windows")]
fn windows_python_name() -> &'static str {
    "python.exe"
}
#[cfg(not(target_os = "windows"))]
fn windows_python_name() -> &'static str {
    "python"
}

#[cfg(target_os = "windows")]
fn venv_python_relative() -> &'static str {
    "Scripts/python.exe"
}
#[cfg(not(target_os = "windows"))]
fn venv_python_relative() -> &'static str {
    "bin/python"
}

fn stable_path_hash(root: &Path, python: &Path) -> u64 {
    root.to_string_lossy()
        .bytes()
        .chain([0])
        .chain(python.to_string_lossy().bytes())
        .fold(0xcbf29ce484222325, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        })
}

fn snapshot(inner: &ProcessInner) -> EnvironmentStatus {
    EnvironmentStatus {
        phase: inner.phase.clone(),
        pid: inner.pid,
        port: inner.port,
        started_at: inner.started_at,
        message: inner.message.clone(),
        profile_id: inner.profile_id.clone(),
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn write_process_ownership(path: &Path, ownership: &ProcessOwnership) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建 ComfyUI 运行记录目录：{error}"))?;
    }
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(ownership)
        .map_err(|error| format!("无法保存 ComfyUI 运行记录：{error}"))?;
    fs::write(&temporary, bytes).map_err(|error| format!("无法写入 ComfyUI 运行记录：{error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("无法更新 ComfyUI 运行记录：{error}"))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("无法提交 ComfyUI 运行记录：{error}"))
}

fn reclaim_stale_owned_process(path: &Path) {
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    let Ok(ownership) = serde_json::from_slice::<ProcessOwnership>(&bytes) else {
        let _ = fs::remove_file(path);
        return;
    };
    if process_matches_ownership(&ownership) {
        terminate_process_tree_sync(Some(ownership.pid));
    }
    let _ = fs::remove_file(path);
}

fn process_matches_ownership(ownership: &ProcessOwnership) -> bool {
    let Some(command_line) = process_command_line(ownership.pid) else {
        return false;
    };
    let normalized = command_line.replace('/', "\\").to_ascii_lowercase();
    let main_path = ownership
        .main_py_path
        .replace('/', "\\")
        .to_ascii_lowercase();
    let port_arg = format!("--port {}", ownership.port);
    let port_equals_arg = format!("--port={}", ownership.port);
    normalized.contains(&main_path)
        && normalized.contains("--listen")
        && normalized.contains(LOOPBACK_HOST)
        && (normalized.contains(&port_arg) || normalized.contains(&port_equals_arg))
}

#[cfg(target_os = "windows")]
fn process_command_line(pid: u32) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let script =
        format!("(Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\").CommandLine");
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .creation_flags(0x08000000)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(unix)]
fn process_command_line(pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(not(any(target_os = "windows", unix)))]
fn process_command_line(_pid: u32) -> Option<String> {
    None
}

async fn terminate_process_tree(child: &mut Child, pid: Option<u32>) {
    #[cfg(target_os = "windows")]
    if let Some(pid) = pid {
        let mut command = Command::new("taskkill.exe");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        command.creation_flags(0x08000000);
        let _ = command.output().await;
    }
    #[cfg(unix)]
    if let Some(pid) = pid {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        if tokio::time::timeout(Duration::from_secs(3), child.wait())
            .await
            .is_err()
        {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
    }
    let _ = child.start_kill();
    let _ = child.wait().await;
}

#[cfg(target_os = "windows")]
fn terminate_process_tree_sync(pid: Option<u32>) {
    if let Some(pid) = pid {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .output();
    }
}

#[cfg(unix)]
fn terminate_process_tree_sync(pid: Option<u32>) {
    if let Some(pid) = pid {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}

#[cfg(not(any(target_os = "windows", unix)))]
fn terminate_process_tree_sync(_pid: Option<u32>) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn detects_windows_portable_layout_without_guessing_system_python() {
        let root = fixture_root("portable");
        touch(&root.join("ComfyUI/main.py"));
        touch(&root.join("python_embeded").join(windows_python_name()));

        let detection = detect_environment_at(&root, None).expect("portable environment");
        let profile = detection.profile.expect("profile");
        assert!(detection.ready);
        assert_eq!(profile.install_kind, ComfyInstallKind::WindowsPortable);
        assert!(profile.main_py_path.ends_with("main.py"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detects_integrated_python_directory_without_case_requirements() {
        let root = fixture_root("integrated-python");
        touch(&root.join("cOmFyUi/Main.PY"));
        let executable_name = if cfg!(target_os = "windows") {
            "Python.ExE"
        } else {
            "Python"
        };
        touch(&root.join("PyThOn").join(executable_name));

        let detection = detect_environment_at(&root, None).expect("integrated environment");
        let profile = detection.profile.expect("profile");
        assert!(detection.ready);
        assert_eq!(profile.install_kind, ComfyInstallKind::WindowsPortable);
        assert!(!profile.root_directory.starts_with(r"\\?\"));
        assert!(!profile.main_py_path.starts_with(r"\\?\"));
        assert!(!profile.python_path.starts_with(r"\\?\"));
        assert!(profile.python_path.to_ascii_lowercase().contains("python"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn removes_windows_verbatim_prefix_before_launching_python() {
        assert_eq!(
            normalize_windows_path(PathBuf::from(r"\\?\J:\ComfyUI-td-v4.0")),
            PathBuf::from(r"J:\ComfyUI-td-v4.0")
        );
        assert_eq!(
            normalize_windows_path(PathBuf::from(r"\\?\UNC\server\share\ComfyUI")),
            PathBuf::from(r"\\server\share\ComfyUI")
        );
    }

    #[test]
    fn detects_source_venv_and_builds_loopback_launch_args() {
        let root = fixture_root("venv");
        touch(&root.join("main.py"));
        touch(&root.join(".venv").join(venv_python_relative()));
        let profile = detect_environment_at(&root, None)
            .expect("venv environment")
            .profile
            .expect("profile");
        assert_eq!(profile.install_kind, ComfyInstallKind::SourceVenv);

        let launch = build_launch_spec(&profile).expect("launch spec");
        let args = launch
            .args
            .iter()
            .map(|value| value.to_string_lossy())
            .collect::<Vec<_>>();
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--listen", LOOPBACK_HOST])
        );
        assert!(args.iter().any(|arg| arg == "--disable-auto-launch"));
        assert!(!args.iter().any(|arg| arg == "0.0.0.0"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reports_missing_python_and_rejects_network_overrides() {
        let root = fixture_root("missing-python");
        touch(&root.join("main.py"));
        let detection = detect_environment_at(&root, None).expect("partial environment");
        assert!(!detection.ready);
        assert!(detection.profile.is_none());
        assert!(detection.issues[0].contains("Python"));
        assert!(validate_extra_args(&["--listen=0.0.0.0".to_owned()]).is_err());
        assert!(validate_extra_args(&["--port".to_owned(), "8188".to_owned()]).is_err());
        assert!(validate_extra_args(&["--li".to_owned(), "0.0.0.0".to_owned()]).is_err());
        assert!(validate_extra_args(&["--por=9999".to_owned()]).is_err());
        assert!(validate_extra_args(&["--base-directory=C:/temp".to_owned()]).is_err());
        assert!(validate_extra_args(&["--lowvram".to_owned(), "--force-fp16".to_owned()]).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn maps_history_fields_and_sanitizes_cached_result_names() {
        let history = serde_json::json!({
            "images": [{ "filename": "preview.png", "subfolder": "", "type": "output" }],
            "text": ["done"]
        });
        let image = RequestedOutput {
            id: "9:result".to_owned(),
            node_id: "9".to_owned(),
            result_field: Some("images".to_owned()),
            label: "图片".to_owned(),
            resource_type: "image".to_owned(),
        };
        let selected = select_result_value(&history, &image).expect("image field");
        assert_eq!(selected[0]["filename"], "preview.png");
        assert_eq!(
            sanitize_result_filename("../bad:name?.png", "result.bin"),
            "bad_name_.png"
        );
        assert_eq!(mime_from_filename("clip.WEBM"), Some("video/webm"));
        assert_eq!(
            video_output_directory(Path::new("ComfyUI"), "测试画布"),
            PathBuf::from("ComfyUI").join("output").join("测试画布")
        );
        assert_eq!(
            comfy_result_source_path(Path::new("ComfyUI"), "output", "clips/final", "clip.mp4"),
            Some(PathBuf::from("ComfyUI").join("output").join("clips/final").join("clip.mp4"))
        );
        assert!(comfy_result_source_path(Path::new("ComfyUI"), "output", "../escape", "clip.mp4").is_none());
    }

    #[test]
    fn recognizes_comfy_execution_errors() {
        let failure = serde_json::json!({
            "status": {
                "status_str": "error",
                "messages": [["execution_error", { "exception_message": "out of memory" }]]
            }
        });
        assert!(execution_failed(&failure));
        assert!(execution_error(&failure).contains("out of memory"));
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_virtualenv_python_symlink_as_the_executable() {
        use std::os::unix::fs::symlink;

        let root = fixture_root("venv-symlink");
        touch(&root.join("main.py"));
        let target = root.join("system-python");
        touch(&target);
        let venv_python = root.join(".venv/bin/python");
        fs::create_dir_all(venv_python.parent().expect("venv parent")).expect("venv directory");
        symlink(&target, &venv_python).expect("python symlink");

        let profile = detect_environment_at(&root, None)
            .expect("venv environment")
            .profile
            .expect("profile");
        assert!(profile.python_path.ends_with(".venv/bin/python"));
        assert_eq!(profile.install_kind, ComfyInstallKind::SourceVenv);
        let _ = fs::remove_dir_all(root);
    }

    fn fixture_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("tdcanvas-comfyui-{label}-{}", now_millis()));
        fs::create_dir_all(&root).expect("fixture root");
        root
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().expect("parent")).expect("fixture parent");
        fs::write(path, b"").expect("fixture file");
    }
}
