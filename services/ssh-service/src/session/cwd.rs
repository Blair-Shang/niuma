//! Resolves the interactive PTY shell cwd on a remote Linux host.

use serde_json::{json, Value};

use super::manager::SessionManager;

/// Finds the newest interactive shell (pts/tty) cwd, excluding this exec process.
const CWD_SCRIPT: &str = r#"
SELF=$$
best_pid=0
best_cwd=""
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  [ "$pid" = "$SELF" ] && continue
  comm=$(cat "$p/comm" 2>/dev/null) || continue
  case "$comm" in
    bash|zsh|fish|sh|ash|dash|ksh|tcsh|csh) ;;
    *) continue ;;
  esac
  fd0=$(readlink "$p/fd/0" 2>/dev/null) || continue
  case "$fd0" in
    /dev/pts/*|/dev/tty*) ;;
    *) continue ;;
  esac
  cwd=$(readlink "$p/cwd" 2>/dev/null) || continue
  [ -n "$cwd" ] || continue
  if [ "$pid" -gt "$best_pid" ] 2>/dev/null; then
    best_pid=$pid
    best_cwd=$cwd
  fi
done
if [ -n "$best_cwd" ]; then
  printf '%s\n' "$best_cwd"
  exit 0
fi
pwd
"#;

/// Sanitizes a remote cwd so the Web SFTP pane can navigate it.
pub fn normalize_remote_cwd(raw: &str) -> Option<String> {
    let trimmed = raw.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.chars().any(|ch| ch.is_control()) {
        return None;
    }
    if trimmed == "~" || trimmed.starts_with("~/") {
        return Some(trimmed);
    }
    if trimmed.starts_with('/') {
        let collapsed = collapse_slashes(&trimmed);
        return Some(if collapsed.is_empty() {
            "/".to_string()
        } else {
            collapsed
        });
    }
    None
}

fn collapse_slashes(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut prev_slash = false;
    for ch in path.chars() {
        if ch == '/' {
            if prev_slash {
                continue;
            }
            prev_slash = true;
            out.push(ch);
            continue;
        }
        prev_slash = false;
        out.push(ch);
    }
    out
}

/// Queries the remote interactive shell cwd for a PTY terminal.
pub async fn terminal_cwd(manager: &SessionManager, terminal_id: &str) -> Result<Value, String> {
    let session_id = manager.session_id_for_terminal(terminal_id).await?;
    let result = manager
        .exec(&session_id, CWD_SCRIPT.trim(), "terminal.cwd", false)
        .await?;
    let stdout = result["stdout"].as_str().unwrap_or("");
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|row| !row.is_empty())
        .unwrap_or("");
    let path = normalize_remote_cwd(line).ok_or_else(|| "terminal cwd unavailable".to_string())?;
    Ok(json!({ "path": path }))
}

#[cfg(test)]
mod tests {
    use super::normalize_remote_cwd;

    #[test]
    fn accepts_unix_and_tilde() {
        assert_eq!(normalize_remote_cwd("/var/www").as_deref(), Some("/var/www"));
        assert_eq!(normalize_remote_cwd("~/src").as_deref(), Some("~/src"));
        assert_eq!(normalize_remote_cwd("/var//www").as_deref(), Some("/var/www"));
        assert_eq!(normalize_remote_cwd("relative"), None);
        assert_eq!(normalize_remote_cwd(""), None);
    }
}
