use std::fs::OpenOptions;
use std::io::Write;
use std::panic;
use std::path::PathBuf;

use crate::resolve::resolve_log_dir;

/// install_crash_dump 把 panic 正文追加到 <logDir>/crashes/<service>-crash.log。
pub fn install_crash_dump(service_name: &str) {
    let Some(log_dir) = resolve_log_dir() else {
        return;
    };
    let crash_dir = log_dir.join("crashes");
    if std::fs::create_dir_all(&crash_dir).is_err() {
        return;
    }
    let path = crash_dir.join(format!("{service_name}-crash.log"));
    let service = service_name.to_string();
    let prev = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        write_panic_file(&path, &service, &info.to_string());
        prev(info);
    }));
}

fn write_panic_file(path: &PathBuf, service: &str, payload: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "--- panic service={service} payload={payload} ---");
    }
}
