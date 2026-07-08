use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// MAX_FILE_BYTES 是单日志文件上限（100 MiB）。
pub const MAX_FILE_BYTES: u64 = 100 << 20;

/// RotatingWriter 在达到上限时滚动为 `.log.1`（旧 `.log.1` 覆盖）。
pub struct RotatingWriter {
    path: PathBuf,
    max_size: u64,
    inner: Mutex<Inner>,
}

struct Inner {
    file: Option<File>,
    size: u64,
}

impl RotatingWriter {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            max_size: MAX_FILE_BYTES,
            inner: Mutex::new(Inner {
                file: None,
                size: 0,
            }),
        }
    }

    pub fn write_bytes(&self, buf: &[u8]) -> io::Result<usize> {
        let mut inner = self.inner.lock().unwrap();
        if inner.file.is_none() {
            open_file(&mut inner, &self.path)?;
        }
        if inner.size + buf.len() as u64 > self.max_size {
            rotate(&mut inner, &self.path)?;
        }
        let file = inner.file.as_mut().expect("file opened");
        let n = file.write(buf)?;
        inner.size += n as u64;
        Ok(n)
    }

    pub fn flush_bytes(&self) -> io::Result<()> {
        let mut inner = self.inner.lock().unwrap();
        if let Some(file) = inner.file.as_mut() {
            file.flush()?;
        }
        Ok(())
    }
}

/// LogWriter 供 tracing-subscriber 使用的 `Write` 适配器。
pub struct LogWriter(pub std::sync::Arc<RotatingWriter>);

impl Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write_bytes(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush_bytes()
    }
}

fn open_file(inner: &mut Inner, path: &Path) -> io::Result<()> {
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let size = file.metadata()?.len();
    inner.file = Some(file);
    inner.size = size;
    Ok(())
}

fn rotate(inner: &mut Inner, path: &Path) -> io::Result<()> {
    if let Some(file) = inner.file.take() {
        drop(file);
    }
    let backup = path.with_extension("log.1");
    let _ = fs::remove_file(&backup);
    if path.is_file() {
        fs::rename(path, &backup)?;
    }
    inner.size = 0;
    open_file(inner, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rolls_at_max_size() {
        let dir = std::env::temp_dir().join(format!("niuma-logutil-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("test.log");
        let w = RotatingWriter {
            path: path.clone(),
            max_size: 8,
            inner: Mutex::new(Inner {
                file: None,
                size: 0,
            }),
        };
        w.write_bytes(b"1234567890").unwrap();
        assert!(path.is_file());
        let _ = fs::remove_dir_all(dir);
    }
}
