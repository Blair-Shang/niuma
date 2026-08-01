package tools

import (
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

// progressReader 包装 stdin，按字节上报还原进度（不依赖 mysql --verbose）。
type progressReader struct {
	r        io.Reader
	total    int64
	read     int64
	taskID   string
	emit     func(taskID, phase, message string)
	mu       sync.Mutex
	lastEmit time.Time
	stallAt  time.Time
}

func newProgressReader(r io.Reader, total int64, taskID string, emit func(taskID, phase, message string)) *progressReader {
	return &progressReader{
		r:       r,
		total:   total,
		taskID:  taskID,
		emit:    emit,
		stallAt: time.Now(),
	}
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	if n > 0 {
		p.mu.Lock()
		p.read += int64(n)
		p.stallAt = time.Now()
		read := p.read
		total := p.total
		due := p.lastEmit.IsZero() || time.Since(p.lastEmit) >= 400*time.Millisecond
		if due {
			p.lastEmit = time.Now()
		}
		p.mu.Unlock()
		if due && p.emit != nil {
			p.emit(p.taskID, "running", formatRestoreProgress(read, total, 0))
		}
	}
	if err == io.EOF && p.emit != nil {
		p.mu.Lock()
		read := p.read
		total := p.total
		p.mu.Unlock()
		p.emit(p.taskID, "running", formatRestoreProgress(read, total, 0))
	}
	return n, err
}

// snapshot 供心跳读取当前进度；stalledFor 是距离上次从文件读到字节的时长。
func (p *progressReader) snapshot() (read, total int64, stalledFor time.Duration) {
	if p == nil {
		return 0, 0, 0
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.read, p.total, time.Since(p.stallAt)
}

func formatRestoreProgress(read, total int64, stalledFor time.Duration) string {
	base := ""
	if total > 0 {
		pct := read * 100 / total
		if pct > 100 {
			pct = 100
		}
		base = fmt.Sprintf("restoring… %s / %s read (%d%%)", formatBytes(read), formatBytes(total), pct)
	} else {
		base = fmt.Sprintf("restoring… %s read", formatBytes(read))
	}
	if stalledFor >= 2*time.Second {
		// 读文件停住：常见于执行大 SQL，或客户端 stderr 被堵（旧版 --verbose 会死锁）
		sec := int(stalledFor.Seconds())
		return fmt.Sprintf("%s — mysql busy %ds (running SQL; stdin paused)", base, sec)
	}
	return base
}

func formatBytes(n int64) string {
	const (
		kb = 1024
		mb = 1024 * kb
		gb = 1024 * mb
	)
	switch {
	case n >= gb:
		return fmt.Sprintf("%.2f GB", float64(n)/float64(gb))
	case n >= mb:
		return fmt.Sprintf("%.1f MB", float64(n)/float64(mb))
	case n >= kb:
		return fmt.Sprintf("%.0f KB", float64(n)/float64(kb))
	default:
		return fmt.Sprintf("%d B", n)
	}
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}
