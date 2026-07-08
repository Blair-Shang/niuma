package logutil

import (
	"fmt"
	"os"
	"sync"
)

// MaxFileBytes 单日志文件上限（100 MiB）。
const MaxFileBytes = 100 << 20

// rotatingWriter 在达到上限时滚动为 .log.1（旧 .log.1 覆盖）。
type rotatingWriter struct {
	path    string
	maxSize int64
	mu      sync.Mutex
	file    *os.File
	size    int64
}

func newRotatingWriter(path string) *rotatingWriter {
	return &rotatingWriter{path: path, maxSize: MaxFileBytes}
}

func (w *rotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.file == nil {
		if err := w.open(); err != nil {
			return 0, err
		}
	}
	if w.size+int64(len(p)) > w.maxSize {
		if err := w.rotate(); err != nil {
			return 0, err
		}
	}
	n, err := w.file.Write(p)
	if err != nil {
		return n, err
	}
	w.size += int64(n)
	return n, nil
}

func (w *rotatingWriter) open() error {
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	w.file = f
	w.size = st.Size()
	return nil
}

func (w *rotatingWriter) rotate() error {
	if w.file != nil {
		_ = w.file.Close()
		w.file = nil
	}
	backup := w.path + ".1"
	_ = os.Remove(backup)
	if _, err := os.Stat(w.path); err == nil {
		if err := os.Rename(w.path, backup); err != nil {
			return fmt.Errorf("logutil: rotate %s: %w", w.path, err)
		}
	}
	w.size = 0
	return w.open()
}

func (w *rotatingWriter) close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}
