use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::{Path, PathBuf},
    time::Duration,
};

use futures_util::StreamExt;
use reqwest::{
    Client, Response, Url,
    header::{CONTENT_TYPE, LOCATION},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    net::lookup_host,
    sync::Mutex,
};

const MAX_MEDIA_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const MANIFEST_FILENAME: &str = "manifest.json";

pub struct MediaCacheState {
    cache_dir: PathBuf,
    client: Client,
    commit_lock: Mutex<()>,
}

impl MediaCacheState {
    pub fn new(cache_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        std::fs::create_dir_all(&cache_dir)?;
        let client = Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(180))
            .user_agent("TDCanvas/0.14 desktop-media-cache")
            .build()?;
        Ok(Self {
            cache_dir,
            client,
            commit_lock: Mutex::new(()),
        })
    }

    async fn cache_remote_media(
        &self,
        source: &str,
        requested_filename: Option<&str>,
    ) -> Result<CachedMediaResult, String> {
        let source_url = parse_remote_url(source)?;
        let source_hash = sha256(source.as_bytes());

        {
            let _guard = self.commit_lock.lock().await;
            let manifest = read_manifest(&self.cache_dir).await?;
            if let Some(entry) = manifest.sources.get(&source_hash)
                && cache_file_is_available(&self.cache_dir, entry).await
            {
                return Ok(cache_result(&self.cache_dir, entry, true));
            }
        }

        let response = fetch_public_media(&self.client, source_url.clone()).await?;
        if let Some(length) = response.content_length()
            && length > MAX_MEDIA_BYTES
        {
            return Err("远程文件超过 1 GB 缓存限制".into());
        }
        let mime_type = resolve_media_type(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            &source_url,
            requested_filename,
        )?;
        let extension = media_extension(&mime_type)
            .ok_or_else(|| "远程文件不是支持的图片、视频或音频格式".to_string())?;
        let filename =
            build_cache_filename(requested_filename, &source_url, extension, &source_hash);
        let temp_path = self.cache_dir.join(format!(
            ".incoming-{}-{}.tmp",
            std::process::id(),
            &source_hash[..12]
        ));

        let download_result = download_response(response, &temp_path).await;
        let (bytes, content_hash) = match download_result {
            Ok(result) => result,
            Err(error) => {
                let _ = fs::remove_file(&temp_path).await;
                return Err(error);
            }
        };

        let _guard = self.commit_lock.lock().await;
        let mut manifest = read_manifest(&self.cache_dir).await?;
        if let Some(entry) = manifest.sources.get(&source_hash)
            && cache_file_is_available(&self.cache_dir, entry).await
        {
            let _ = fs::remove_file(&temp_path).await;
            return Ok(cache_result(&self.cache_dir, entry, true));
        }

        let final_path = self.cache_dir.join(&filename);
        if fs::try_exists(&final_path).await.unwrap_or(false) {
            fs::remove_file(&final_path)
                .await
                .map_err(|error| format!("无法替换旧缓存文件：{error}"))?;
        }
        fs::rename(&temp_path, &final_path)
            .await
            .map_err(|error| format!("无法提交本地缓存文件：{error}"))?;

        let entry = MediaCacheEntry {
            source_url_hash: source_hash.clone(),
            source: source.to_string(),
            filename,
            content_hash,
            mime_type,
            bytes,
            created_at: unix_timestamp_millis(),
        };
        manifest.sources.insert(source_hash, entry.clone());
        write_manifest(&self.cache_dir, &manifest).await?;
        Ok(cache_result(&self.cache_dir, &entry, false))
    }

    async fn import_legacy_cached_media(
        &self,
        absolute_path: &str,
        expected_source: &str,
    ) -> Result<CachedMediaResult, String> {
        let source_url = parse_remote_url(expected_source)?;
        let source_hash = sha256(expected_source.as_bytes());
        let source_path = fs::canonicalize(absolute_path)
            .await
            .map_err(|error| format!("旧缓存文件不可读：{error}"))?;
        let legacy_dir = source_path
            .parent()
            .ok_or_else(|| "旧缓存路径无效".to_string())?;
        let data_dir = legacy_dir
            .parent()
            .ok_or_else(|| "旧缓存路径无效".to_string())?;
        if legacy_dir.file_name().and_then(|value| value.to_str()) != Some("media-cache")
            || data_dir.file_name().and_then(|value| value.to_str()) != Some("data")
        {
            return Err("旧缓存路径不属于 TDCanvas data/media-cache".into());
        }

        let manifest_bytes = fs::read(legacy_dir.join(MANIFEST_FILENAME))
            .await
            .map_err(|error| format!("旧缓存索引不可读：{error}"))?;
        let legacy_manifest: LegacyMediaCacheManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| format!("旧缓存索引已损坏：{error}"))?;
        let legacy_entry = legacy_manifest
            .sources
            .get(&source_hash)
            .filter(|entry| entry.source == expected_source && entry.source_url_hash == source_hash)
            .ok_or_else(|| "旧缓存索引与素材来源不匹配".to_string())?;
        if source_path.file_name().and_then(|value| value.to_str())
            != Some(legacy_entry.filename.as_str())
        {
            return Err("旧缓存文件名与索引不匹配".into());
        }
        let metadata = fs::metadata(&source_path)
            .await
            .map_err(|error| format!("旧缓存文件不可读：{error}"))?;
        if !metadata.is_file()
            || metadata.len() != legacy_entry.bytes
            || metadata.len() > MAX_MEDIA_BYTES
        {
            return Err("旧缓存文件大小与索引不匹配".into());
        }
        let content_hash = hash_file(&source_path).await?;
        if content_hash != legacy_entry.content_hash {
            return Err("旧缓存文件校验失败".into());
        }
        let extension = media_extension(&legacy_entry.mime_type)
            .ok_or_else(|| "旧缓存文件格式不受支持".to_string())?;
        let filename = build_cache_filename(
            Some(&legacy_entry.filename),
            &source_url,
            extension,
            &source_hash,
        );

        let _guard = self.commit_lock.lock().await;
        let mut manifest = read_manifest(&self.cache_dir).await?;
        if let Some(entry) = manifest.sources.get(&source_hash)
            && cache_file_is_available(&self.cache_dir, entry).await
        {
            return Ok(cache_result(&self.cache_dir, entry, true));
        }

        let temp_path = self.cache_dir.join(format!(
            ".migrating-{}-{}.tmp",
            std::process::id(),
            &source_hash[..12]
        ));
        fs::copy(&source_path, &temp_path)
            .await
            .map_err(|error| format!("旧缓存迁移失败：{error}"))?;
        let final_path = self.cache_dir.join(&filename);
        if fs::try_exists(&final_path).await.unwrap_or(false) {
            fs::remove_file(&final_path)
                .await
                .map_err(|error| format!("无法替换旧缓存文件：{error}"))?;
        }
        fs::rename(&temp_path, &final_path)
            .await
            .map_err(|error| format!("无法提交迁移缓存：{error}"))?;

        let entry = MediaCacheEntry {
            source_url_hash: source_hash.clone(),
            source: expected_source.to_string(),
            filename,
            content_hash,
            mime_type: legacy_entry.mime_type.clone(),
            bytes: legacy_entry.bytes,
            created_at: unix_timestamp_millis(),
        };
        manifest.sources.insert(source_hash, entry.clone());
        write_manifest(&self.cache_dir, &manifest).await?;
        Ok(cache_result(&self.cache_dir, &entry, false))
    }
}

#[tauri::command]
pub async fn cache_remote_media(
    state: State<'_, MediaCacheState>,
    url: String,
    filename: Option<String>,
) -> Result<CachedMediaResult, String> {
    state
        .cache_remote_media(url.trim(), filename.as_deref())
        .await
}

#[tauri::command]
pub async fn import_legacy_cached_media(
    state: State<'_, MediaCacheState>,
    absolute_path: String,
    source_url: String,
) -> Result<CachedMediaResult, String> {
    state
        .import_legacy_cached_media(absolute_path.trim(), source_url.trim())
        .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMediaResult {
    absolute_path: String,
    filename: String,
    mime_type: String,
    bytes: u64,
    content_hash: String,
    cached: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaCacheEntry {
    source_url_hash: String,
    source: String,
    filename: String,
    content_hash: String,
    mime_type: String,
    bytes: u64,
    created_at: u128,
}

#[derive(Serialize, Deserialize)]
struct MediaCacheManifest {
    version: u8,
    sources: HashMap<String, MediaCacheEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMediaCacheEntry {
    source_url_hash: String,
    source: String,
    filename: String,
    content_hash: String,
    mime_type: String,
    bytes: u64,
}

#[derive(Deserialize)]
struct LegacyMediaCacheManifest {
    sources: HashMap<String, LegacyMediaCacheEntry>,
}

impl Default for MediaCacheManifest {
    fn default() -> Self {
        Self {
            version: 1,
            sources: HashMap::new(),
        }
    }
}

async fn fetch_public_media(client: &Client, mut url: Url) -> Result<Response, String> {
    for redirects in 0..=MAX_REDIRECTS {
        validate_public_destination(&url).await?;
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|error| format!("远程素材连接失败：{error}"))?;
        if response.status().is_redirection() {
            if redirects == MAX_REDIRECTS {
                return Err("远程素材重定向次数过多".into());
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "远程素材返回了无目标地址的重定向".to_string())?;
            url = url
                .join(location)
                .map_err(|_| "远程素材重定向地址无效".to_string())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("远程素材返回 HTTP {}", response.status().as_u16()));
        }
        return Ok(response);
    }
    Err("远程素材重定向次数过多".into())
}

async fn download_response(response: Response, target: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::create(target)
        .await
        .map_err(|error| format!("无法创建本地缓存文件：{error}"))?;
    let mut stream = response.bytes_stream();
    let mut bytes = 0_u64;
    let mut hasher = Sha256::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("远程素材读取中断：{error}"))?;
        bytes = bytes
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "远程文件大小溢出".to_string())?;
        if bytes > MAX_MEDIA_BYTES {
            return Err("远程文件超过 1 GB 缓存限制".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("本地缓存写入失败：{error}"))?;
    }
    file.flush()
        .await
        .map_err(|error| format!("本地缓存写入失败：{error}"))?;
    if bytes == 0 {
        return Err("远程素材返回了空文件".into());
    }
    Ok((bytes, hex::encode(hasher.finalize())))
}

async fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .await
        .map_err(|error| format!("无法读取缓存文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("缓存文件读取中断：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn parse_remote_url(source: &str) -> Result<Url, String> {
    let url = Url::parse(source).map_err(|_| "远程素材地址无效".to_string())?;
    if url.scheme() != "https" {
        return Err("桌面素材缓存只允许 HTTPS 地址".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("远程素材地址不能包含登录凭据".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "远程素材地址缺少主机名".to_string())?;
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
        return Err("远程素材地址指向本机或局域网".into());
    }
    if let Ok(ip) = host.parse::<IpAddr>()
        && is_forbidden_ip(ip)
    {
        return Err("远程素材地址指向受保护网络".into());
    }
    Ok(url)
}

async fn validate_public_destination(url: &Url) -> Result<(), String> {
    let host = url
        .host_str()
        .ok_or_else(|| "远程素材地址缺少主机名".to_string())?;
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(443);
    if let Ok(addresses) = lookup_host((host, port)).await {
        for address in addresses {
            let ip = address.ip();
            if is_forbidden_ip(ip) && !is_synthetic_proxy_ip(ip) {
                return Err("远程素材域名解析到了受保护网络".into());
            }
        }
    }
    Ok(())
}

fn is_synthetic_proxy_ip(ip: IpAddr) -> bool {
    matches!(ip, IpAddr::V4(value) if {
        let octets = value.octets();
        octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
    })
}

fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => is_forbidden_ipv4(value),
        IpAddr::V6(value) => is_forbidden_ipv6(value),
    }
}

fn is_forbidden_ipv4(value: Ipv4Addr) -> bool {
    let [a, b, c, _] = value.octets();
    value.is_private()
        || value.is_loopback()
        || value.is_link_local()
        || value.is_unspecified()
        || value.is_multicast()
        || value == Ipv4Addr::BROADCAST
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 240
}

fn is_forbidden_ipv6(value: Ipv6Addr) -> bool {
    let first = value.segments()[0];
    value.is_loopback()
        || value.is_unspecified()
        || value.is_multicast()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        || (value.segments()[0] == 0x2001 && value.segments()[1] == 0x0db8)
}

fn resolve_media_type(
    content_type: Option<&str>,
    source_url: &Url,
    requested_filename: Option<&str>,
) -> Result<String, String> {
    if let Some(content_type) = content_type {
        let normalized = content_type
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if media_extension(&normalized).is_some() {
            return Ok(normalized);
        }
    }
    for candidate in [
        requested_filename,
        source_url.path_segments().and_then(|parts| parts.last()),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(extension) = Path::new(candidate)
            .extension()
            .and_then(|value| value.to_str())
            && let Some(mime_type) = extension_media_type(extension)
        {
            return Ok(mime_type.to_string());
        }
    }
    Err("无法确认远程素材的文件格式".into())
}

fn media_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/avif" => Some("avif"),
        "image/gif" => Some("gif"),
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "video/mp4" => Some("mp4"),
        "video/quicktime" => Some("mov"),
        "video/webm" => Some("webm"),
        "video/x-matroska" => Some("mkv"),
        "audio/aac" => Some("aac"),
        "audio/flac" => Some("flac"),
        "audio/mp4" => Some("m4a"),
        "audio/mpeg" => Some("mp3"),
        "audio/ogg" => Some("ogg"),
        "audio/wav" | "audio/x-wav" => Some("wav"),
        _ => None,
    }
}

fn extension_media_type(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "avif" => Some("image/avif"),
        "gif" => Some("image/gif"),
        "jpeg" | "jpg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "mp4" => Some("video/mp4"),
        "mov" => Some("video/quicktime"),
        "webm" => Some("video/webm"),
        "mkv" => Some("video/x-matroska"),
        "aac" => Some("audio/aac"),
        "flac" => Some("audio/flac"),
        "m4a" => Some("audio/mp4"),
        "mp3" => Some("audio/mpeg"),
        "ogg" => Some("audio/ogg"),
        "wav" => Some("audio/wav"),
        _ => None,
    }
}

fn build_cache_filename(
    requested_filename: Option<&str>,
    source_url: &Url,
    extension: &str,
    source_hash: &str,
) -> String {
    let candidate = requested_filename
        .filter(|value| !value.trim().is_empty())
        .or_else(|| source_url.path_segments().and_then(|parts| parts.last()))
        .unwrap_or("tdcanvas-media");
    let stem = Path::new(candidate)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("tdcanvas-media");
    let stem = sanitize_filename_stem(stem);
    format!("{stem}-{}.{}", &source_hash[..12], extension)
}

fn sanitize_filename_stem(value: &str) -> String {
    let mut stem: String = value
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    stem = stem.trim_matches([' ', '.']).trim().to_string();
    if stem.is_empty() {
        stem = "tdcanvas-media".into();
    }
    if is_windows_reserved_name(&stem) {
        stem.insert(0, '_');
    }
    stem.chars().take(120).collect()
}

fn is_windows_reserved_name(value: &str) -> bool {
    let upper = value.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.as_bytes()[3].is_ascii_digit())
}

async fn read_manifest(cache_dir: &Path) -> Result<MediaCacheManifest, String> {
    let path = cache_dir.join(MANIFEST_FILENAME);
    if !fs::try_exists(&path).await.unwrap_or(false) {
        return Ok(MediaCacheManifest::default());
    }
    let bytes = fs::read(&path)
        .await
        .map_err(|error| format!("无法读取缓存索引：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("缓存索引已损坏：{error}"))
}

async fn write_manifest(cache_dir: &Path, manifest: &MediaCacheManifest) -> Result<(), String> {
    let path = cache_dir.join(MANIFEST_FILENAME);
    let temp = cache_dir.join("manifest.next.json");
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("无法生成缓存索引：{error}"))?;
    fs::write(&temp, bytes)
        .await
        .map_err(|error| format!("无法写入缓存索引：{error}"))?;
    if fs::try_exists(&path).await.unwrap_or(false) {
        fs::remove_file(&path)
            .await
            .map_err(|error| format!("无法更新缓存索引：{error}"))?;
    }
    fs::rename(&temp, &path)
        .await
        .map_err(|error| format!("无法提交缓存索引：{error}"))
}

async fn cache_file_is_available(cache_dir: &Path, entry: &MediaCacheEntry) -> bool {
    let path = cache_dir.join(&entry.filename);
    path.parent() == Some(cache_dir)
        && fs::metadata(path)
            .await
            .map(|metadata| metadata.is_file() && metadata.len() == entry.bytes)
            .unwrap_or(false)
}

fn cache_result(cache_dir: &Path, entry: &MediaCacheEntry, cached: bool) -> CachedMediaResult {
    CachedMediaResult {
        absolute_path: cache_dir
            .join(&entry.filename)
            .to_string_lossy()
            .into_owned(),
        filename: entry.filename.clone(),
        mime_type: entry.mime_type.clone(),
        bytes: entry.bytes,
        content_hash: entry.content_hash.clone(),
        cached,
    }
}

fn sha256(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn unix_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_private_and_literal_proxy_addresses() {
        assert!(parse_remote_url("https://127.0.0.1/file.png").is_err());
        assert!(parse_remote_url("https://10.0.0.2/file.png").is_err());
        assert!(parse_remote_url("https://198.18.0.127/file.png").is_err());
        assert!(parse_remote_url("https://getapib.org/file.png").is_ok());
    }

    #[test]
    fn sanitizes_cross_platform_filenames() {
        assert_eq!(sanitize_filename_stem("a:b/c*?"), "a_b_c__");
        assert_eq!(sanitize_filename_stem("CON"), "_CON");
        assert_eq!(sanitize_filename_stem(" . "), "tdcanvas-media");
    }

    #[test]
    fn resolves_supported_media_extensions() {
        assert_eq!(media_extension("image/png"), Some("png"));
        assert_eq!(extension_media_type("MOV"), Some("video/quicktime"));
        assert_eq!(media_extension("text/html"), None);
    }

    #[tokio::test]
    async fn imports_verified_web_cache_into_desktop_cache() {
        let root =
            std::env::temp_dir().join(format!("tdcanvas-cache-migration-{}", std::process::id()));
        let legacy_dir = root.join("data").join("media-cache");
        let desktop_dir = root.join("desktop-cache");
        let _ = fs::remove_dir_all(&root).await;
        fs::create_dir_all(&legacy_dir)
            .await
            .expect("create legacy cache");
        let source = "https://cdn.example/generated.png";
        let source_hash = sha256(source.as_bytes());
        let bytes = b"verified legacy image";
        let content_hash = sha256(bytes);
        let filename = "generated.png";
        fs::write(legacy_dir.join(filename), bytes)
            .await
            .expect("write legacy image");
        fs::write(
            legacy_dir.join(MANIFEST_FILENAME),
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "sources": {
                    source_hash.clone(): {
                        "sourceUrlHash": source_hash,
                        "source": source,
                        "filename": filename,
                        "contentHash": content_hash,
                        "mimeType": "image/png",
                        "bytes": bytes.len(),
                        "createdAt": "2026-08-24T00:00:00.000Z"
                    }
                }
            }))
            .expect("serialize manifest"),
        )
        .await
        .expect("write manifest");

        let state = MediaCacheState::new(desktop_dir).expect("create desktop cache");
        let result = state
            .import_legacy_cached_media(
                legacy_dir.join(filename).to_string_lossy().as_ref(),
                source,
            )
            .await
            .expect("import legacy cache");
        assert_eq!(result.bytes, bytes.len() as u64);
        assert!(Path::new(&result.absolute_path).is_file());
        assert_eq!(
            fs::read(&result.absolute_path)
                .await
                .expect("read migrated image"),
            bytes
        );
        fs::remove_dir_all(root)
            .await
            .expect("remove migration fixture");
    }

    #[tokio::test]
    #[ignore = "requires TDCANVAS_MEDIA_SMOKE_URL and public network access"]
    async fn caches_configured_public_media() {
        let source = std::env::var("TDCANVAS_MEDIA_SMOKE_URL")
            .expect("TDCANVAS_MEDIA_SMOKE_URL is required");
        let cache_dir = std::env::temp_dir().join(format!(
            "tdcanvas-native-cache-smoke-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&cache_dir).await;
        let state = MediaCacheState::new(cache_dir.clone()).expect("create media cache state");
        let result = state
            .cache_remote_media(&source, Some("native-cache-smoke.png"))
            .await
            .expect("cache public media");
        assert!(result.bytes > 0);
        assert!(Path::new(&result.absolute_path).is_file());
        fs::remove_dir_all(cache_dir)
            .await
            .expect("remove media cache smoke directory");
    }
}
