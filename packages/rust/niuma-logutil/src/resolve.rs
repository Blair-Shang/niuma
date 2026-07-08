use std::env;
use std::path::{Path, PathBuf};

/// resolve_log_dir 返回落盘目录。
pub fn resolve_log_dir() -> Option<PathBuf> {
    if let Ok(dir) = env::var("NIUMMA_LOG_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    if let Ok(root) = env::var("NIUMMA_LOG_ROOT") {
        if !root.is_empty() {
            return Some(PathBuf::from(root));
        }
    }
    find_repo_logs_dir()
}

fn find_repo_logs_dir() -> Option<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    for start in log_search_roots() {
        if !seen.insert(start.clone()) {
            continue;
        }
        if let Some(repo) = find_repo_root(&start) {
            return Some(repo.join("logs"));
        }
    }
    None
}

fn log_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = env::current_dir() {
        roots.push(cwd);
    }
    roots
}

fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut dir = start.to_path_buf();
    for _ in 0..12 {
        if dir.join("package.json").is_file() {
            return Some(dir);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_repo_logs_from_workspace() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo = manifest
            .ancestors()
            .find(|p| p.join("package.json").is_file())
            .expect("repo root");
        let got = find_repo_logs_dir().expect("logs dir");
        assert_eq!(got, repo.join("logs"));
    }
}
