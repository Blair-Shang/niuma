use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use russh::client;
use russh::Disconnect;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileType, OpenFlags};
use serde_json::{json, Value};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, Notify};

use crate::eventpub::AsyncPublisher;

use super::connect::{open_sftp_session, SftpClientHandler, MAX_FILE_READ_SIZE};

pub type ProgressCb = Arc<dyn Fn(u64, u64, u64) + Send + Sync>;

/// SessionEntry 保存一条已打开 SFTP 子系统的传输会话。
pub struct SessionEntry {
    pub handle: Arc<Mutex<client::Handle<SftpClientHandler>>>,
    pub sftp: Arc<Mutex<Option<SftpSession>>>,
    /// 跳板机 SSH 隧道守卫；drop 时自动关闭本地转发端口。
    pub _tunnel: Option<niuma_tunnel::TunnelGuard>,
}

/// SessionManager 管理活跃 SFTP 会话（无终端 / exec / 监控）。
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    events: AsyncPublisher,
}

impl SessionManager {
    pub fn new(events: AsyncPublisher) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            events,
        }
    }

    pub async fn insert(
        &self,
        session_id: String,
        handle: client::Handle<SftpClientHandler>,
        sftp: SftpSession,
        tunnel: Option<niuma_tunnel::TunnelGuard>,
    ) -> Result<(), String> {
        let entry = SessionEntry {
            handle: Arc::new(Mutex::new(handle)),
            sftp: Arc::new(Mutex::new(Some(sftp))),
            _tunnel: tunnel,
        };
        self.sessions.lock().await.insert(session_id, entry);
        Ok(())
    }

    pub async fn close(&self, session_id: &str) -> Result<(), String> {
        let entry = {
            let mut map = self.sessions.lock().await;
            map.remove(session_id)
        };
        match entry {
            Some(entry) => {
                {
                    let mut sftp = entry.sftp.lock().await;
                    *sftp = None;
                }
                let handle = entry.handle.lock().await;
                let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
                Ok(())
            }
            None => Err(format!("session not found: {session_id}")),
        }
    }

    pub async fn sftp_dir_list(&self, session_id: &str, path: &str) -> Result<Value, String> {
        let sftp = self.ensure_sftp(session_id).await?;
        let list_result = {
            let sftp = sftp.lock().await;
            let client = sftp.as_ref().expect("sftp session");
            match client.read_dir(path).await {
                Ok(read_dir) => {
                    let entries: Vec<Value> = read_dir
                        .map(|ent| {
                            let kind = match ent.file_type() {
                                FileType::Dir => "dir",
                                _ => "file",
                            };
                            let meta = ent.metadata();
                            json!({
                                "name": ent.file_name(),
                                "kind": kind,
                                "size": meta.size.unwrap_or(0),
                                "modifiedAt": meta.mtime.map(|t| t.to_string()).unwrap_or_default(),
                                "permissions": meta.permissions.unwrap_or_default(),
                            })
                        })
                        .collect();
                    let resolved_path = client
                        .canonicalize(path)
                        .await
                        .unwrap_or_else(|_| path.to_string());
                    Ok(json!({ "path": resolved_path, "entries": entries }))
                }
                Err(e) => Err(format!("sftp: list {path:?}: {e}")),
            }
        };
        if let Err(ref e) = list_result {
            self.note_if_lost(session_id, e).await;
        }
        list_result
    }

    pub async fn sftp_file_read(&self, session_id: &str, path: &str) -> Result<Value, String> {
        let sftp = self.ensure_sftp(session_id).await?;
        let sftp = sftp.lock().await;
        let client = sftp.as_ref().expect("sftp session");
        let meta = client
            .metadata(path)
            .await
            .map_err(|e| format!("sftp: stat {path:?}: {e}"))?;
        let size = meta.size.unwrap_or(0) as usize;
        if size > MAX_FILE_READ_SIZE {
            return Err(format!(
                "file too large: {size} bytes (max {MAX_FILE_READ_SIZE})"
            ));
        }
        let buf = client
            .read(path)
            .await
            .map_err(|e| format!("sftp: read {path:?}: {e}"))?;
        if buf.len() > MAX_FILE_READ_SIZE {
            return Err(format!(
                "file too large: {} bytes (max {MAX_FILE_READ_SIZE})",
                buf.len()
            ));
        }
        Ok(json!({
            "path": path,
            "content": String::from_utf8_lossy(&buf).into_owned(),
            "size": buf.len(),
        }))
    }

    pub async fn sftp_file_write(&self, session_id: &str, path: &str, content: &[u8]) -> Result<Value, String> {
        let sftp = self.ensure_sftp(session_id).await?;
        let sftp = sftp.lock().await;
        let client = sftp.as_ref().expect("sftp session");
        let mut file = client
            .open_with_flags(
                path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE | OpenFlags::READ,
            )
            .await
            .map_err(|e| format!("sftp: open {path:?}: {e}"))?;
        file.write_all(content)
            .await
            .map_err(|e| format!("sftp: write {path:?}: {e}"))?;
        file.flush()
            .await
            .map_err(|e| format!("sftp: flush {path:?}: {e}"))?;
        Ok(json!({ "written": true, "path": path }))
    }

    pub async fn sftp_dir_make(&self, session_id: &str, path: &str) -> Result<Value, String> {
        let sftp = self.ensure_sftp(session_id).await?;
        let sftp = sftp.lock().await;
        let client = sftp.as_ref().expect("sftp session");
        client
            .create_dir(path)
            .await
            .map_err(|e| format!("sftp: mkdir {path:?}: {e}"))?;
        Ok(json!({ "created": true, "path": path }))
    }

    pub async fn sftp_entry_delete(
        &self,
        session_id: &str,
        path: &str,
        kind: &str,
        recursive: bool,
    ) -> Result<Value, String> {
        let sftp = self.ensure_sftp(session_id).await?;
        let sftp = sftp.lock().await;
        let client = sftp.as_ref().expect("sftp session");
        if kind == "dir" {
            if recursive {
                remove_dir_recursive(client, path).await?;
            } else {
                client
                    .remove_dir(path)
                    .await
                    .map_err(|e| format!("sftp: rmdir {path:?}: {e}"))?;
            }
        } else {
            client
                .remove_file(path)
                .await
                .map_err(|e| format!("sftp: remove {path:?}: {e}"))?;
        }
        Ok(json!({ "deleted": true, "path": path }))
    }

    pub async fn sftp_entry_rename(
        &self,
        session_id: &str,
        from_path: &str,
        to_path: &str,
    ) -> Result<Value, String> {
        let sftp = self.ensure_sftp(session_id).await?;
        let sftp = sftp.lock().await;
        let client = sftp.as_ref().expect("sftp session");
        client
            .rename(from_path, to_path)
            .await
            .map_err(|e| format!("sftp: rename {from_path:?} -> {to_path:?}: {e}"))?;
        Ok(json!({ "renamed": true, "fromPath": from_path, "toPath": to_path }))
    }

    pub async fn ensure_sftp_public(
        &self,
        session_id: &str,
    ) -> Result<Arc<Mutex<Option<SftpSession>>>, String> {
        self.ensure_sftp(session_id).await
    }

    pub async fn sftp_download_path(
        &self,
        session_id: &str,
        remote: &str,
        local: &Path,
        cancel: tokio_util::sync::CancellationToken,
        resume: Arc<Notify>,
        paused: Arc<Mutex<bool>>,
        on_progress: ProgressCb,
    ) -> Result<(), String> {
        use crate::transfer::{copy_remote_file_to_local, join_remote_path, wait_if_paused};

        #[derive(Clone)]
        struct WalkItem {
            remote: String,
            local: PathBuf,
        }

        let sftp = self.ensure_sftp(session_id).await?;
        let mut stack = vec![WalkItem {
            remote: remote.to_string(),
            local: local.to_path_buf(),
        }];
        let transferred_total = Arc::new(AtomicU64::new(0));

        while let Some(item) = stack.pop() {
            wait_if_paused(&cancel, &paused, &resume).await?;

            let is_dir = {
                let guard = sftp.lock().await;
                let client = guard.as_ref().ok_or("sftp session missing")?;
                let meta = client
                    .metadata(&item.remote)
                    .await
                    .map_err(|e| format!("sftp: stat {:?}: {e}", item.remote))?;
                meta.is_dir()
            };

            if is_dir {
                fs::create_dir_all(&item.local)
                    .await
                    .map_err(|e| format!("mkdir local {:?}: {e}", item.local))?;
                let children = {
                    let guard = sftp.lock().await;
                    let client = guard.as_ref().ok_or("sftp session missing")?;
                    let read_dir = client
                        .read_dir(&item.remote)
                        .await
                        .map_err(|e| format!("sftp: list {:?}: {e}", item.remote))?;
                    read_dir
                        .map(|ent| (ent.file_name().to_string(), ent.file_type() == FileType::Dir))
                        .collect::<Vec<_>>()
                };
                for (name, _) in children {
                    if name == "." || name == ".." {
                        continue;
                    }
                    stack.push(WalkItem {
                        remote: join_remote_path(&item.remote, &name),
                        local: item.local.join(&name),
                    });
                }
                continue;
            }

            let progress = Arc::clone(&on_progress);
            let completed = Arc::clone(&transferred_total);
            copy_remote_file_to_local(
                self,
                session_id,
                &item.remote,
                &item.local,
                cancel.clone(),
                Arc::clone(&paused),
                resume.clone(),
                {
                    let completed = Arc::clone(&completed);
                    move |t, tot, speed| {
                        let base = completed.load(Ordering::Relaxed);
                        progress(base + t, base + tot.max(t), speed);
                    }
                },
            )
            .await?;
            let file_size = fs::metadata(&item.local)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            transferred_total.fetch_add(file_size, Ordering::Relaxed);
        }
        Ok(())
    }

    pub async fn sftp_upload_path(
        &self,
        session_id: &str,
        local: &Path,
        remote: &str,
        cancel: tokio_util::sync::CancellationToken,
        resume: Arc<Notify>,
        paused: Arc<Mutex<bool>>,
        on_progress: ProgressCb,
    ) -> Result<(), String> {
        use crate::transfer::{copy_local_file_to_remote, join_remote_path, wait_if_paused};

        #[derive(Clone)]
        struct WalkItem {
            local: PathBuf,
            remote: String,
        }

        let mut stack = vec![WalkItem {
            local: local.to_path_buf(),
            remote: remote.to_string(),
        }];
        let transferred_total = Arc::new(AtomicU64::new(0));

        while let Some(item) = stack.pop() {
            wait_if_paused(&cancel, &paused, &resume).await?;
            let meta = fs::metadata(&item.local)
                .await
                .map_err(|e| format!("stat local {:?}: {e}", item.local))?;

            if meta.is_dir() {
                {
                    let sftp = self.ensure_sftp(session_id).await?;
                    let guard = sftp.lock().await;
                    let client = guard.as_ref().ok_or("sftp session missing")?;
                    if !client.try_exists(&item.remote).await.unwrap_or(false) {
                        client
                            .create_dir(&item.remote)
                            .await
                            .map_err(|e| format!("sftp: mkdir {:?}: {e}", item.remote))?;
                    }
                }
                let mut read_dir = fs::read_dir(&item.local)
                    .await
                    .map_err(|e| format!("read local dir {:?}: {e}", item.local))?;
                while let Some(entry) = read_dir
                    .next_entry()
                    .await
                    .map_err(|e| format!("read local dir {:?}: {e}", item.local))?
                {
                    let name = entry.file_name().to_string_lossy().to_string();
                    stack.push(WalkItem {
                        local: entry.path(),
                        remote: join_remote_path(&item.remote, &name),
                    });
                }
                continue;
            }

            let progress = Arc::clone(&on_progress);
            let completed = Arc::clone(&transferred_total);
            let file_size = meta.len();
            copy_local_file_to_remote(
                self,
                session_id,
                &item.local,
                &item.remote,
                cancel.clone(),
                Arc::clone(&paused),
                resume.clone(),
                {
                    let completed = Arc::clone(&completed);
                    move |t, tot, speed| {
                        let base = completed.load(Ordering::Relaxed);
                        progress(base + t, base + tot.max(t), speed);
                    }
                },
            )
            .await?;
            transferred_total.fetch_add(file_size, Ordering::Relaxed);
        }
        Ok(())
    }

    async fn handle_ref(
        &self,
        session_id: &str,
    ) -> Result<Arc<Mutex<client::Handle<SftpClientHandler>>>, String> {
        let map = self.sessions.lock().await;
        map.get(session_id)
            .map(|entry| Arc::clone(&entry.handle))
            .ok_or_else(|| format!("session not found: {session_id}"))
    }

    async fn sftp_ref(&self, session_id: &str) -> Result<Arc<Mutex<Option<SftpSession>>>, String> {
        let map = self.sessions.lock().await;
        map.get(session_id)
            .map(|entry| Arc::clone(&entry.sftp))
            .ok_or_else(|| format!("session not found: {session_id}"))
    }

    async fn note_if_lost(&self, session_id: &str, err: &str) {
        if !is_transport_lost(err) {
            return;
        }
        let _ = self.close(session_id).await;
        self.events.emit(json!({
            "type": "sftp.session.state",
            "sessionId": session_id,
            "state": "lost",
            "message": err,
        }));
    }

    async fn ensure_sftp(&self, session_id: &str) -> Result<Arc<Mutex<Option<SftpSession>>>, String> {
        let result: Result<Arc<Mutex<Option<SftpSession>>>, String> = async {
            let handle = self.handle_ref(session_id).await?;
            let sftp = self.sftp_ref(session_id).await?;
            let mut sftp_guard = sftp.lock().await;
            if sftp_guard.is_none() {
                let handle = handle.lock().await;
                let session = open_sftp_session(&handle).await?;
                *sftp_guard = Some(session);
            }
            drop(sftp_guard);
            Ok(sftp)
        }
        .await;
        if let Err(ref e) = result {
            self.note_if_lost(session_id, e).await;
        }
        result
    }
}

fn is_transport_lost(err: &str) -> bool {
    let m = err.to_ascii_lowercase();
    if m.is_empty() || m.contains("session not found") || m.contains("session busy") {
        return false;
    }
    m.contains("broken pipe")
        || m.contains("connection reset")
        || m.contains("connection refused")
        || m.contains("unexpected eof")
        || m.contains("connection lost")
        || m.contains("disconnect")
        || m.contains("channel closed")
        || m.contains("session closed")
        || m.contains("connection aborted")
}

async fn remove_dir_recursive(client: &SftpSession, path: &str) -> Result<(), String> {
    let read_dir = client
        .read_dir(path)
        .await
        .map_err(|e| format!("sftp: list {path:?}: {e}"))?;
    for entry in read_dir {
        let name = entry.file_name();
        let child = if path.ends_with('/') {
            format!("{path}{name}")
        } else {
            format!("{path}/{name}")
        };
        if entry.file_type() == FileType::Dir {
            Box::pin(remove_dir_recursive(client, &child)).await?;
        } else {
            client
                .remove_file(&child)
                .await
                .map_err(|e| format!("sftp: remove {child:?}: {e}"))?;
        }
    }
    client
        .remove_dir(path)
        .await
        .map_err(|e| format!("sftp: rmdir {path:?}: {e}"))
}
