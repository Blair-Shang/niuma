use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use russh::client::{self, Msg};
use russh::{Channel, ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileType, OpenFlags};
use serde_json::{json, Value};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, Mutex, Notify};
use tracing::{error, warn};

use crate::eventpub::AsyncPublisher;

use super::connect::{SshClientHandler, MAX_FILE_READ_SIZE};

pub type ProgressCb = Arc<dyn Fn(u64, u64, u64) + Send + Sync>;

/// TerminalState 表示终端子会话的生命周期状态。
#[derive(Clone, Copy)]
pub enum TerminalState {
    Opening,
    Ready,
    Closed,
    Lost,
    Error,
}

impl TerminalState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Opening => "opening",
            Self::Ready => "ready",
            Self::Closed => "closed",
            Self::Lost => "lost",
            Self::Error => "error",
        }
    }
}

enum TerminalCommand {
    Input(String),
    Resize { cols: u32, rows: u32 },
    Close,
}

struct TerminalEntry {
    session_id: String,
    tx: mpsc::UnboundedSender<TerminalCommand>,
}

struct MonitorCacheEntry {
    captured_at: Instant,
    value: Value,
}

const MONITOR_CACHE_TTL: Duration = Duration::from_secs(2);

/// SessionEntry 保存一条 SSH 会话及其懒初始化的 SFTP 子会话。
pub struct SessionEntry {
    pub handle: Arc<Mutex<client::Handle<SshClientHandler>>>,
    pub sftp: Arc<Mutex<Option<SftpSession>>>,
    /// 跳板机 SSH 隧道守卫；drop 时自动关闭本地转发端口。
    pub _tunnel: Option<niuma_tunnel::TunnelGuard>,
}

/// SessionManager 管理活跃 SSH 会话与交互式终端子会话。
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    terminals: Arc<Mutex<HashMap<String, TerminalEntry>>>,
    monitor_cache: Arc<Mutex<HashMap<String, MonitorCacheEntry>>>,
    monitor_inflight: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
    events: AsyncPublisher,
}

impl SessionManager {
    pub fn new(events: AsyncPublisher) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            terminals: Arc::new(Mutex::new(HashMap::new())),
            monitor_cache: Arc::new(Mutex::new(HashMap::new())),
            monitor_inflight: Arc::new(Mutex::new(HashMap::new())),
            events,
        }
    }

    pub async fn insert(
        &self,
        session_id: String,
        handle: client::Handle<SshClientHandler>,
        tunnel: Option<niuma_tunnel::TunnelGuard>,
    ) -> Result<(), String> {
        let entry = SessionEntry {
            handle: Arc::new(Mutex::new(handle)),
            sftp: Arc::new(Mutex::new(None)),
            _tunnel: tunnel,
        };
        self.sessions.lock().await.insert(session_id, entry);
        Ok(())
    }

    pub async fn close(&self, session_id: &str) -> Result<(), String> {
        let terminal_ids = {
            let terminals = self.terminals.lock().await;
            terminals
                .iter()
                .filter(|(_, entry)| entry.session_id == session_id)
                .map(|(terminal_id, _)| terminal_id.clone())
                .collect::<Vec<_>>()
        };
        for terminal_id in terminal_ids {
            let _ = self.close_terminal(&terminal_id).await;
        }

        let entry = {
            let mut map = self.sessions.lock().await;
            map.remove(session_id)
        };
        self.monitor_cache.lock().await.remove(session_id);
        if let Some(notify) = self.monitor_inflight.lock().await.remove(session_id) {
            notify.notify_waiters();
        }
        match entry {
            Some(entry) => {
                let handle = entry.handle.lock().await;
                let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
                Ok(())
            }
            None => Err(format!("session not found: {session_id}")),
        }
    }

    pub async fn exec(
        &self,
        session_id: &str,
        command: &str,
        exec_id: &str,
        stream: bool,
    ) -> Result<Value, String> {
        let handle = self.handle_ref(session_id).await?;
        let handle = handle.lock().await;
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("exec: open session: {e}"))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| format!("exec: run command: {e}"))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = 0i32;

        if stream {
            self.events.emit(json!({
                "type": "ssh.exec.state",
                "sessionId": session_id,
                "execId": exec_id,
                "state": "opening",
                "message": "",
            }));
        }

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    if !stream {
                        stdout.extend_from_slice(&data);
                    }
                    if stream {
                        self.events.emit(json!({
                            "type": "ssh.exec.data",
                            "sessionId": session_id,
                            "execId": exec_id,
                            "stream": "stdout",
                            "data": String::from_utf8_lossy(&data).into_owned(),
                        }));
                    }
                }
                Some(ChannelMsg::ExtendedData { data, ext: 1 }) => {
                    if !stream {
                        stderr.extend_from_slice(&data);
                    }
                    if stream {
                        self.events.emit(json!({
                            "type": "ssh.exec.data",
                            "sessionId": session_id,
                            "execId": exec_id,
                            "stream": "stderr",
                            "data": String::from_utf8_lossy(&data).into_owned(),
                        }));
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = exit_status as i32,
                Some(ChannelMsg::Eof) | None => break,
                Some(_) => {}
            }
        }

        if stream {
            self.events.emit(json!({
                "type": "ssh.exec.exit",
                "sessionId": session_id,
                "execId": exec_id,
                "exitCode": exit_code,
            }));
            self.events.emit(json!({
                "type": "ssh.exec.state",
                "sessionId": session_id,
                "execId": exec_id,
                "state": "closed",
                "message": "",
            }));
        }

        Ok(json!({
            "execId": exec_id,
            "streamed": stream,
            "stdout": if stream { String::new() } else { String::from_utf8_lossy(&stdout).into_owned() },
            "stderr": if stream { String::new() } else { String::from_utf8_lossy(&stderr).into_owned() },
            "exitCode": exit_code,
        }))
    }

    pub async fn open_terminal(
        &self,
        session_id: &str,
        terminal_id: String,
        cols: u32,
        rows: u32,
        term_type: &str,
    ) -> Result<(), String> {
        let handle = self.handle_ref(session_id).await?;
        let handle = handle.lock().await;
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("terminal: open channel: {e}"))?;
        channel
            .request_pty(true, term_type, cols, rows, 0, 0, &[])
            .await
            .map_err(|e| format!("terminal: request pty: {e}"))?;
        channel
            .request_shell(true)
            .await
            .map_err(|e| format!("terminal: request shell: {e}"))?;
        drop(handle);

        let (tx, rx) = mpsc::unbounded_channel();
        self.terminals.lock().await.insert(
            terminal_id.clone(),
            TerminalEntry {
                session_id: session_id.to_string(),
                tx,
            },
        );
        self.emit_terminal_state(session_id, &terminal_id, TerminalState::Opening, None);

        let terminals = Arc::clone(&self.terminals);
        let events = self.events.clone();
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            run_terminal_task(terminals, events, session_id, terminal_id, channel, rx).await;
        });
        Ok(())
    }

    pub async fn terminal_input(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        self.send_terminal_command(terminal_id, TerminalCommand::Input(data.to_string()))
            .await
    }

    pub async fn resize_terminal(&self, terminal_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        self.send_terminal_command(terminal_id, TerminalCommand::Resize { cols, rows })
            .await
    }

    pub async fn close_terminal(&self, terminal_id: &str) -> Result<(), String> {
        self.send_terminal_command(terminal_id, TerminalCommand::Close).await
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
            // copy_* 回调的 t 是「当前文件内累计字节」，不是增量；不可对 t 做 fetch_add。
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
            // copy_* 回调的 t 是「当前文件内累计字节」，不是增量；不可对 t 做 fetch_add。
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

    fn emit_terminal_state(
        &self,
        session_id: &str,
        terminal_id: &str,
        state: TerminalState,
        message: Option<String>,
    ) {
        self.events.emit(json!({
            "type": "ssh.terminal.state",
            "sessionId": session_id,
            "terminalId": terminal_id,
            "state": state.as_str(),
            "message": message.unwrap_or_default(),
        }));
    }

    async fn send_terminal_command(
        &self,
        terminal_id: &str,
        command: TerminalCommand,
    ) -> Result<(), String> {
        let maybe_tx = {
            let terminals = self.terminals.lock().await;
            terminals.get(terminal_id).map(|entry| entry.tx.clone())
        };
        match maybe_tx {
            Some(tx) => tx
                .send(command)
                .map_err(|_| format!("terminal not available: {terminal_id}")),
            None => Err(format!("terminal not found: {terminal_id}")),
        }
    }

    async fn handle_ref(
        &self,
        session_id: &str,
    ) -> Result<Arc<Mutex<client::Handle<SshClientHandler>>>, String> {
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
            "type": "ssh.session.state",
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
                let channel = handle
                    .channel_open_session()
                    .await
                    .map_err(|e| format!("sftp: open channel: {e}"))?;
                channel
                    .request_subsystem(true, "sftp")
                    .await
                    .map_err(|e| format!("sftp: subsystem: {e}"))?;
                let session = SftpSession::new(channel.into_stream())
                    .await
                    .map_err(|e| format!("sftp: handshake: {e}"))?;
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

async fn run_terminal_task(
    terminals: Arc<Mutex<HashMap<String, TerminalEntry>>>,
    events: AsyncPublisher,
    session_id: String,
    terminal_id: String,
    mut channel: Channel<Msg>,
    mut rx: mpsc::UnboundedReceiver<TerminalCommand>,
) {
    let mut writer = channel.make_writer();
    let mut lost = false;
    let mut saw_exit = false;

    events.emit(json!({
        "type": "ssh.terminal.state",
        "sessionId": session_id,
        "terminalId": terminal_id,
        "state": TerminalState::Ready.as_str(),
        "message": "",
    }));

    loop {
        tokio::select! {
            maybe_cmd = rx.recv() => {
                match maybe_cmd {
                    Some(TerminalCommand::Input(data)) => {
                        if let Err(err) = writer.write_all(data.as_bytes()).await {
                            error!(%err, terminal = %terminal_id, "terminal input write failed");
                            events.emit(json!({
                                "type": "ssh.terminal.state",
                                "sessionId": session_id,
                                "terminalId": terminal_id,
                                "state": TerminalState::Error.as_str(),
                                "message": err.to_string(),
                            }));
                            break;
                        }
                        let _ = writer.flush().await;
                    }
                    Some(TerminalCommand::Resize { cols, rows }) => {
                        if let Err(err) = channel.window_change(cols, rows, 0, 0).await {
                            warn!(%err, terminal = %terminal_id, "terminal resize failed");
                        }
                    }
                    Some(TerminalCommand::Close) => {
                        let _ = channel.eof().await;
                        let _ = channel.close().await;
                        break;
                    }
                    None => break,
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        events.emit(json!({
                            "type": "ssh.terminal.data",
                            "sessionId": session_id,
                            "terminalId": terminal_id,
                            "stream": "stdout",
                            "data": String::from_utf8_lossy(&data).into_owned(),
                        }));
                    }
                    Some(ChannelMsg::ExtendedData { data, ext }) => {
                        events.emit(json!({
                            "type": "ssh.terminal.data",
                            "sessionId": session_id,
                            "terminalId": terminal_id,
                            "stream": if ext == 1 { "stderr" } else { "stdout" },
                            "data": String::from_utf8_lossy(&data).into_owned(),
                        }));
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        saw_exit = true;
                        events.emit(json!({
                            "type": "ssh.terminal.exit",
                            "sessionId": session_id,
                            "terminalId": terminal_id,
                            "exitCode": exit_status,
                        }));
                    }
                    Some(ChannelMsg::Close) | None => {
                        lost = !saw_exit;
                        break;
                    }
                    Some(ChannelMsg::Eof) => {}
                    Some(_) => {}
                }
            }
        }
    }

    terminals.lock().await.remove(&terminal_id);
    events.emit(json!({
        "type": "ssh.terminal.state",
        "sessionId": session_id,
        "terminalId": terminal_id,
        "state": if lost { TerminalState::Lost.as_str() } else { TerminalState::Closed.as_str() },
        "message": "",
    }));
}

impl SessionManager {
    /// Collects system performance metrics from the remote host.
    pub async fn collect_metrics(&self, session_id: &str) -> Result<Value, String> {
        loop {
            if let Some(cached) = self.monitor_cache_get(session_id).await {
                return Ok(cached);
            }
            if let Some(notify) = self.monitor_try_join(session_id).await {
                notify.notified().await;
                continue;
            }

            let result = super::monitor::collect_metrics(self, session_id).await;
            self.monitor_finish(session_id).await;
            return result;
        }
    }

    pub(crate) async fn monitor_cache_get(&self, session_id: &str) -> Option<Value> {
        let cache = self.monitor_cache.lock().await;
        let entry = cache.get(session_id)?;
        if entry.captured_at.elapsed() > MONITOR_CACHE_TTL {
            return None;
        }
        Some(entry.value.clone())
    }

    pub(crate) async fn monitor_cache_set(&self, session_id: &str, value: &Value) {
        self.monitor_cache.lock().await.insert(
            session_id.to_string(),
            MonitorCacheEntry {
                captured_at: Instant::now(),
                value: value.clone(),
            },
        );
    }

    async fn monitor_try_join(&self, session_id: &str) -> Option<Arc<Notify>> {
        let mut inflight = self.monitor_inflight.lock().await;
        if let Some(notify) = inflight.get(session_id) {
            return Some(Arc::clone(notify));
        }
        inflight.insert(session_id.to_string(), Arc::new(Notify::new()));
        None
    }

    async fn monitor_finish(&self, session_id: &str) {
        let notify = self.monitor_inflight.lock().await.remove(session_id);
        if let Some(notify) = notify {
            notify.notify_waiters();
        }
    }
}
