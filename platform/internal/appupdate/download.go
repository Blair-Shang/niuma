// Package appupdate 实现桌面本体安装包的受限下载与校验。
// 不代理 cloud；仅 HTTPS + host allowlist；校验 SHA-256 后供 Shell 拉起 Setup。
package appupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	httpTimeout       = 45 * time.Minute
	progressMinGap    = 100 * time.Millisecond
	maxRedirects      = 5
	dirName           = "niuma-update"
	EventProgressType = "shell.update.download.progress"
)

var (
	ErrHostNotAllowed = errors.New("download host not allowed")
	ErrInvalidURL     = errors.New("invalid download url")
	ErrHashMismatch   = errors.New("hash_mismatch")
	ErrCancelled      = errors.New("cancelled")
)

// ProgressFunc 下载进度回调。
type ProgressFunc func(received, total int64)

type Manager struct {
	mu       sync.Mutex
	cancel   context.CancelFunc
	hosts    []string
	tempRoot string
}

func New(allowedHosts []string) *Manager {
	hosts := normalizeHosts(allowedHosts)
	if len(hosts) == 0 {
		// 默认允许官方站、GitHub Release（含跳转后的 objects.githubusercontent.com）
		// 其它 CDN：设置 NIUMA_UPDATE_DOWNLOAD_HOSTS=cdn.example.com,niuma007.com
		hosts = []string{"niuma007.com", "www.niuma007.com", "github.com", "githubusercontent.com"}
	}
	return &Manager{hosts: hosts, tempRoot: filepath.Join(os.TempDir(), dirName)}
}

func normalizeHosts(in []string) []string {
	var out []string
	for _, h := range in {
		h = strings.ToLower(strings.TrimSpace(h))
		if h != "" {
			out = append(out, h)
		}
	}
	return out
}

func (m *Manager) UpdateDir() string {
	return m.tempRoot
}

func (m *Manager) Cancel() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
}

// Download 下载到临时目录，返回本地绝对路径。
func (m *Manager) Download(ctx context.Context, rawURL, expectSHA string, expectSize int64, onProgress ProgressFunc) (string, int64, error) {
	if err := ValidateDownloadURL(rawURL, m.hosts); err != nil {
		return "", 0, err
	}
	expectSHA = strings.ToLower(strings.TrimSpace(expectSHA))
	if len(expectSHA) != 64 {
		return "", 0, fmt.Errorf("invalid sha256")
	}

	if err := os.MkdirAll(m.tempRoot, 0o755); err != nil {
		return "", 0, err
	}

	name, err := safeFileName(rawURL)
	if err != nil {
		return "", 0, err
	}
	destPath := filepath.Join(m.tempRoot, name)
	tmpPath := destPath + ".part"

	ctx, cancel := context.WithCancel(ctx)
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
	}
	m.cancel = cancel
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		if m.cancel != nil {
			m.cancel = nil
		}
		m.mu.Unlock()
		cancel()
	}()

	_ = os.Remove(tmpPath)
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", 0, err
	}
	client := &http.Client{
		Timeout: httpTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("too many redirects")
			}
			return ValidateDownloadURL(req.URL.String(), m.hosts)
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return "", 0, ErrCancelled
		}
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, fmt.Errorf("http %d", resp.StatusCode)
	}
	total := resp.ContentLength
	if expectSize > 0 {
		total = expectSize
	}
	hasher := sha256.New()
	writer := io.MultiWriter(f, hasher)
	pw := &progressWriter{w: writer, total: total, onBytes: onProgress, minInterval: progressMinGap}
	if _, err := io.Copy(pw, resp.Body); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		if errors.Is(err, context.Canceled) {
			return "", 0, ErrCancelled
		}
		return "", 0, err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", 0, err
	}
	sum := hex.EncodeToString(hasher.Sum(nil))
	if sum != expectSHA {
		_ = os.Remove(tmpPath)
		return "", 0, ErrHashMismatch
	}
	_ = os.Remove(destPath)
	if err := os.Rename(tmpPath, destPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", 0, err
	}
	if strings.HasSuffix(strings.ToLower(destPath), ".run") {
		_ = os.Chmod(destPath, 0o755)
	}
	st, err := os.Stat(destPath)
	if err != nil {
		return "", 0, err
	}
	return destPath, st.Size(), nil
}

func (m *Manager) Verify(path, expectSHA string) error {
	expectSHA = strings.ToLower(strings.TrimSpace(expectSHA))
	if len(expectSHA) != 64 {
		return fmt.Errorf("invalid sha256")
	}
	clean, err := m.ensureUnderUpdateDir(path)
	if err != nil {
		return err
	}
	f, err := os.Open(clean)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	if sum != expectSHA {
		return ErrHashMismatch
	}
	return nil
}

func (m *Manager) ensureUnderUpdateDir(path string) (string, error) {
	clean := filepath.Clean(path)
	root := filepath.Clean(m.tempRoot) + string(os.PathSeparator)
	if clean != filepath.Clean(m.tempRoot) && !strings.HasPrefix(clean, root) {
		return "", fmt.Errorf("path outside update dir")
	}
	return clean, nil
}

// ValidateDownloadURL 仅允许 https 与 allowlist host；拒绝凭据与 IP/内网。
func ValidateDownloadURL(raw string, allowedHosts []string) error {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return ErrInvalidURL
	}
	if u.User != nil {
		return ErrInvalidURL
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || host == "localhost" {
		return ErrHostNotAllowed
	}
	if ip := net.ParseIP(host); ip != nil {
		return ErrHostNotAllowed
	}
	ok := false
	for _, h := range allowedHosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			ok = true
			break
		}
	}
	if !ok {
		return ErrHostNotAllowed
	}
	return nil
}

func safeFileName(rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", ErrInvalidURL
	}
	base := filepath.Base(u.Path)
	base = strings.ReplaceAll(base, "..", "")
	base = filepath.Base(base)
	if base == "" || base == "." || base == string(os.PathSeparator) {
		return "", ErrInvalidURL
	}
	// Windows：仅允许常见安装包后缀
	lower := strings.ToLower(base)
	if !strings.HasSuffix(lower, ".exe") && !strings.HasSuffix(lower, ".msi") &&
		!strings.HasSuffix(lower, ".pkg") && !strings.HasSuffix(lower, ".dmg") &&
		!strings.HasSuffix(lower, ".deb") && !strings.HasSuffix(lower, ".rpm") &&
		!strings.HasSuffix(lower, ".run") {
		return "", fmt.Errorf("unsupported installer extension")
	}
	return base, nil
}

type progressWriter struct {
	w           io.Writer
	total       int64
	received    int64
	onBytes     ProgressFunc
	minInterval time.Duration
	lastEmit    time.Time
}

func (p *progressWriter) Write(b []byte) (int, error) {
	n, err := p.w.Write(b)
	p.received += int64(n)
	if p.onBytes != nil {
		now := time.Now()
		if p.lastEmit.IsZero() || now.Sub(p.lastEmit) >= p.minInterval {
			p.onBytes(p.received, p.total)
			p.lastEmit = now
		}
	}
	return n, err
}
