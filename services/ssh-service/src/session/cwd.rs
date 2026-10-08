//! Reads the interactive shell cwd for the current SSH session.
//!
//! A separate `pwd` runs in a new exec channel and stays in the login directory.
//! The shell's `/proc/<pid>/cwd` is what `pwd` prints after `cd`.

use serde_json::{json, Value};

use super::manager::SessionManager;

/// Prints the cwd of the PTY shell started by this SSH session.
const PWD_SCRIPT: &str = r#"self=$$
sshd=
pid=$self
i=0
while [ "$i" -lt 8 ]; do
  comm=$(cat "/proc/$pid/comm" 2>/dev/null) || break
  case "$comm" in
    sshd|sshd-session|dropbear) sshd=$pid; break ;;
  esac
  ppid=$(sed -n 's/^PPid:[ \t]*//p' "/proc/$pid/status" 2>/dev/null | head -n 1)
  [ -n "$ppid" ] && [ "$ppid" != 0 ] && [ "$ppid" != "$pid" ] || break
  pid=$ppid
  i=$((i + 1))
done
[ -n "$sshd" ] || exit 1
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  ppid=$(sed -n 's/^PPid:[ \t]*//p' "$p/status" 2>/dev/null | head -n 1)
  [ "$ppid" = "$sshd" ] || continue
  comm=$(cat "$p/comm" 2>/dev/null) || continue
  case "$comm" in
    bash|zsh|fish|sh|ash|dash|ksh|tcsh|csh) ;;
    *) continue ;;
  esac
  fd0=$(readlink "$p/fd/0" 2>/dev/null) || continue
  case "$fd0" in
    /dev/pts/*) ;;
    *) continue ;;
  esac
  cwd=$(readlink "$p/cwd" 2>/dev/null) || continue
  [ -n "$cwd" ] || continue
  printf '%s\n' "$cwd"
  exit 0
done
exit 1
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

/// Queries the interactive shell cwd, then the caller navigates SFTP there.
pub async fn terminal_cwd(manager: &SessionManager, terminal_id: &str) -> Result<Value, String> {
    let session_id = manager.session_id_for_terminal(terminal_id).await?;
    let result = manager
        .exec(&session_id, PWD_SCRIPT, "terminal.cwd", false)
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
    use super::{normalize_remote_cwd, PWD_SCRIPT};

    #[test]
    fn accepts_unix_and_tilde() {
        assert_eq!(normalize_remote_cwd("/var/www").as_deref(), Some("/var/www"));
        assert_eq!(normalize_remote_cwd("~/src").as_deref(), Some("~/src"));
        assert_eq!(normalize_remote_cwd("/var//www").as_deref(), Some("/var/www"));
        assert_eq!(normalize_remote_cwd("relative"), None);
        assert_eq!(normalize_remote_cwd(""), None);
    }

    #[test]
    fn pwd_script_reads_the_pty_shell() {
        assert!(PWD_SCRIPT.contains("readlink \"$p/cwd\""));
        assert!(PWD_SCRIPT.contains("/dev/pts/"));
        assert!(!PWD_SCRIPT.contains("\r"));
        assert!(!PWD_SCRIPT.trim_end().ends_with("pwd"));
    }
}
