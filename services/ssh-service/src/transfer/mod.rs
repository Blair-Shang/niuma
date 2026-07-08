//! SFTP 上传/下载任务队列（内存态，进度经事件推送与 transfer.list 查询）。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;
use tokio::fs::{self, File};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

use crate::eventpub::AsyncPublisher;
use crate::idgen::{IdGenError, Snowflake};
use crate::session::SessionManager;

const COPY_BUFFER: usize = 32 * 1024;
const PROGRESS_EMIT_MIN: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Upload,
    Download,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::Download => "download",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskState {
    Queued,
    Running,
    Paused,
    Done,
    Failed,
    Canceled,
}

impl TaskState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }
}

#[derive(Clone)]
pub struct TransferTask {
    pub task_id: String,
    pub session_id: String,
    pub direction: Direction,
    pub local_path: String,
    pub remote_path: String,
    pub state: TaskState,
    pub total: u64,
    pub transferred: u64,
    pub speed_bps: u64,
    pub error: Option<String>,
}

struct TaskInner {
    snapshot: TransferTask,
    cancel: CancellationToken,
    resume: Arc<Notify>,
    paused: Arc<Mutex<bool>>,
}

#[derive(Debug, serde::Deserialize)]
pub struct EnqueueParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub direction: String,
    #[serde(rename = "localPath")]
    pub local_path: String,
    #[serde(rename = "remotePath")]
    pub remote_path: String,
    /// 覆盖策略（预留，当前传输逻辑统一覆盖写入）
    #[serde(default)]
    #[allow(dead_code)]
    pub overwrite: Option<String>,
}

pub struct TransferManager {
    tasks: Mutex<HashMap<String, TaskInner>>,
    ids: Arc<Snowflake>,
    sessions: Arc<SessionManager>,
    events: AsyncPublisher,
}

impl TransferManager {
    pub fn new(sessions: Arc<SessionManager>, ids: Arc<Snowflake>, events: AsyncPublisher) -> Arc<Self> {
        Arc::new(Self {
            tasks: Mutex::new(HashMap::new()),
            ids,
            sessions,
            events,
        })
    }

    pub async fn enqueue(self: &Arc<Self>, params: EnqueueParams) -> Result<String, String> {
        if params.session_id.is_empty() {
            return Err("sessionId required".to_string());
        }
        if params.local_path.is_empty() || params.remote_path.is_empty() {
            return Err("localPath and remotePath required".to_string());
        }
        let direction = match params.direction.as_str() {
            "upload" => Direction::Upload,
            "download" => Direction::Download,
            other => return Err(format!("invalid direction: {other}")),
        };

        let task_id = self
            .ids
            .next_string()
            .map_err(|e: IdGenError| e.to_string())?;

        let snapshot = TransferTask {
            task_id: task_id.clone(),
            session_id: params.session_id.clone(),
            direction,
            local_path: params.local_path.clone(),
            remote_path: params.remote_path.clone(),
            state: TaskState::Queued,
            total: 0,
            transferred: 0,
            speed_bps: 0,
            error: None,
        };

        let inner = TaskInner {
            snapshot: snapshot.clone(),
            cancel: CancellationToken::new(),
            resume: Arc::new(Notify::new()),
            paused: Arc::new(Mutex::new(false)),
        };

        self.emit_state(&snapshot);
        self.tasks.lock().await.insert(task_id.clone(), inner);

        let mgr = Arc::clone(self);
        let run_id = task_id.clone();
        tokio::spawn(async move {
            mgr.run_task(&run_id).await;
        });

        Ok(task_id)
    }

    pub async fn cancel(&self, task_id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.lock().await;
        let task = tasks
            .get_mut(task_id)
            .ok_or_else(|| format!("task not found: {task_id}"))?;
        task.cancel.cancel();
        task.snapshot.state = TaskState::Canceled;
        self.emit_state(&task.snapshot);
        Ok(())
    }

    pub async fn pause(&self, task_id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.lock().await;
        let task = tasks
            .get_mut(task_id)
            .ok_or_else(|| format!("task not found: {task_id}"))?;
        if task.snapshot.state != TaskState::Running {
            return Err(format!("task not running: {task_id}"));
        }
        *task.paused.lock().await = true;
        task.snapshot.state = TaskState::Paused;
        self.emit_state(&task.snapshot);
        Ok(())
    }

    pub async fn resume(&self, task_id: &str) -> Result<(), String> {
        let notify = {
            let mut tasks = self.tasks.lock().await;
            let task = tasks
                .get_mut(task_id)
                .ok_or_else(|| format!("task not found: {task_id}"))?;
            if task.snapshot.state != TaskState::Paused {
                return Err(format!("task not paused: {task_id}"));
            }
            *task.paused.lock().await = false;
            task.snapshot.state = TaskState::Running;
            self.emit_state(&task.snapshot);
            task.resume.clone()
        };
        notify.notify_one();
        Ok(())
    }

    pub async fn list(&self, session_id: Option<&str>) -> Vec<TransferTask> {
        let tasks = self.tasks.lock().await;
        tasks
            .values()
            .filter(|t| session_id.is_none_or(|sid| t.snapshot.session_id == sid))
            .map(|t| t.snapshot.clone())
            .collect()
    }

    async fn run_task(self: Arc<Self>, task_id: &str) {
        let (session_id, direction, local_path, remote_path, cancel, resume, paused) = {
            let tasks = self.tasks.lock().await;
            let task = match tasks.get(task_id) {
                Some(t) => t,
                None => return,
            };
            (
                task.snapshot.session_id.clone(),
                task.snapshot.direction,
                task.snapshot.local_path.clone(),
                task.snapshot.remote_path.clone(),
                task.cancel.clone(),
                task.resume.clone(),
                Arc::clone(&task.paused),
            )
        };

        self.set_state(task_id, TaskState::Running, None).await;

        let progress_mgr = Arc::clone(&self);
        let progress_task_id = task_id.to_string();
        let on_progress: crate::session::ProgressCb = Arc::new(move |transferred, total, speed| {
            let m = Arc::clone(&progress_mgr);
            let tid = progress_task_id.clone();
            tokio::spawn(async move {
                m.update_progress(&tid, transferred, total, speed).await;
            });
        });
        let result = match direction {
            Direction::Download => {
                self.sessions
                    .sftp_download_path(
                        &session_id,
                        &remote_path,
                        Path::new(&local_path),
                        cancel.clone(),
                        resume,
                        paused,
                        on_progress,
                    )
                    .await
            }
            Direction::Upload => {
                self.sessions
                    .sftp_upload_path(
                        &session_id,
                        Path::new(&local_path),
                        &remote_path,
                        cancel.clone(),
                        resume,
                        paused,
                        on_progress,
                    )
                    .await
            }
        };

        if cancel.is_cancelled() {
            self.set_state(task_id, TaskState::Canceled, None).await;
            return;
        }

        match result {
            Ok(()) => self.set_state(task_id, TaskState::Done, None).await,
            Err(err) => self.set_state(task_id, TaskState::Failed, Some(err)).await,
        }
    }

    async fn update_progress(&self, task_id: &str, transferred: u64, total: u64, speed_bps: u64) {
        let session_id = {
            let mut tasks = self.tasks.lock().await;
            if let Some(task) = tasks.get_mut(task_id) {
                task.snapshot.transferred = transferred;
                task.snapshot.total = total;
                if speed_bps > 0 {
                    task.snapshot.speed_bps = speed_bps;
                }
                task.snapshot.session_id.clone()
            } else {
                return;
            }
        };
        self.events.emit(json!({
            "type": "ssh.transfer.progress",
            "sessionId": session_id,
            "taskId": task_id,
            "transferred": transferred,
            "total": total,
            "speedBps": speed_bps,
        }));
    }

    async fn set_state(&self, task_id: &str, state: TaskState, error: Option<String>) {
        let snapshot = {
            let mut tasks = self.tasks.lock().await;
            let task = match tasks.get_mut(task_id) {
                Some(t) => t,
                None => return,
            };
            task.snapshot.state = state;
            task.snapshot.error = error.clone();
            task.snapshot.clone()
        };
        self.emit_state(&snapshot);
    }

    fn emit_state(&self, task: &TransferTask) {
        self.events.emit(json!({
            "type": "ssh.transfer.state",
            "sessionId": task.session_id,
            "taskId": task.task_id,
            "state": task.state.as_str(),
            "direction": task.direction.as_str(),
            "localPath": task.local_path,
            "remotePath": task.remote_path,
            "total": task.total,
            "transferred": task.transferred,
            "error": task.error.clone().unwrap_or_default(),
        }));
    }
}

pub(crate) async fn wait_if_paused(
    cancel: &CancellationToken,
    paused: &Arc<Mutex<bool>>,
    resume: &Arc<Notify>,
) -> Result<(), String> {
    loop {
        if cancel.is_cancelled() {
            return Err("canceled".to_string());
        }
        if !*paused.lock().await {
            return Ok(());
        }
        tokio::select! {
            _ = cancel.cancelled() => return Err("canceled".to_string()),
            _ = resume.notified() => {}
        }
    }
}

pub(crate) async fn copy_remote_file_to_local(
    sessions: &SessionManager,
    session_id: &str,
    remote: &str,
    local: &Path,
    cancel: CancellationToken,
    paused: Arc<Mutex<bool>>,
    resume: Arc<Notify>,
    mut on_progress: impl FnMut(u64, u64, u64) + Send,
) -> Result<(), String> {
    use russh_sftp::client::SftpSession;

    let sftp = sessions.ensure_sftp_public(session_id).await?;
    let sftp_guard = sftp.lock().await;
    let client: &SftpSession = sftp_guard.as_ref().ok_or("sftp session missing")?;

    let meta = client
        .metadata(remote)
        .await
        .map_err(|e| format!("sftp: stat {remote:?}: {e}"))?;
    let total = meta.size.unwrap_or(0);

    if let Some(parent) = local.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("mkdir local {:?}: {e}", parent))?;
    }

    let mut remote_file = client
        .open(remote)
        .await
        .map_err(|e| format!("sftp: open {remote:?}: {e}"))?;
    let mut local_file = File::create(local)
        .await
        .map_err(|e| format!("create local {:?}: {e}", local))?;

    let mut buf = vec![0u8; COPY_BUFFER];
    let mut transferred = 0u64;
    let mut last_emit = Instant::now();
    let mut last_bytes = 0u64;

    loop {
        wait_if_paused(&cancel, &paused, &resume).await?;
        let n = remote_file
            .read(&mut buf)
            .await
            .map_err(|e| format!("sftp: read {remote:?}: {e}"))?;
        if n == 0 {
            break;
        }
        local_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("write local {:?}: {e}", local))?;
        transferred += n as u64;

        let now = Instant::now();
        if now.duration_since(last_emit) >= PROGRESS_EMIT_MIN || (total > 0 && transferred >= total) {
            let elapsed = now.duration_since(last_emit).as_secs_f64().max(0.001);
            let speed = ((transferred - last_bytes) as f64 / elapsed) as u64;
            on_progress(transferred, total, speed);
            last_emit = now;
            last_bytes = transferred;
        }
    }

    local_file
        .flush()
        .await
        .map_err(|e| format!("flush local {:?}: {e}", local))?;
    on_progress(transferred, total.max(transferred), 0);
    Ok(())
}

pub(crate) async fn copy_local_file_to_remote(
    sessions: &SessionManager,
    session_id: &str,
    local: &Path,
    remote: &str,
    cancel: CancellationToken,
    paused: Arc<Mutex<bool>>,
    resume: Arc<Notify>,
    mut on_progress: impl FnMut(u64, u64, u64) + Send,
) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;

    let meta = fs::metadata(local)
        .await
        .map_err(|e| format!("stat local {:?}: {e}", local))?;
    let total = meta.len();

    let sftp = sessions.ensure_sftp_public(session_id).await?;
    let sftp_guard = sftp.lock().await;
    let client = sftp_guard.as_ref().ok_or("sftp session missing")?;

    let mut remote_file = client
        .open_with_flags(
            remote,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE | OpenFlags::READ,
        )
        .await
        .map_err(|e| format!("sftp: open {remote:?}: {e}"))?;

    let mut local_file = File::open(local)
        .await
        .map_err(|e| format!("open local {:?}: {e}", local))?;

    let mut buf = vec![0u8; COPY_BUFFER];
    let mut transferred = 0u64;
    let mut last_emit = Instant::now();
    let mut last_bytes = 0u64;

    loop {
        wait_if_paused(&cancel, &paused, &resume).await?;
        let n = local_file
            .read(&mut buf)
            .await
            .map_err(|e| format!("read local {:?}: {e}", local))?;
        if n == 0 {
            break;
        }
        remote_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("sftp: write {remote:?}: {e}"))?;
        transferred += n as u64;

        let now = Instant::now();
        if now.duration_since(last_emit) >= PROGRESS_EMIT_MIN || transferred >= total {
            let elapsed = now.duration_since(last_emit).as_secs_f64().max(0.001);
            let speed = ((transferred - last_bytes) as f64 / elapsed) as u64;
            on_progress(transferred, total, speed);
            last_emit = now;
            last_bytes = transferred;
        }
    }

    remote_file
        .flush()
        .await
        .map_err(|e| format!("sftp: flush {remote:?}: {e}"))?;
    on_progress(transferred, total.max(transferred), 0);
    Ok(())
}

pub(crate) fn join_remote_path(base: &str, name: &str) -> String {
    let base = base.trim().replace('\\', "/");
    let name = name.trim().replace('\\', "/");
    if base.is_empty() || base == "." {
        return name;
    }
    if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

