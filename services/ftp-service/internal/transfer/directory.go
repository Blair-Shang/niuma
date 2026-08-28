package transfer

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/jlaffaye/ftp"
)

type remoteFile struct {
	remote string
	rel    string
	size   int64
}

type localFile struct {
	local string
	rel   string
	size  int64
}

func remotePathJoin(base, rel string) string {
	base = normalizeRemotePath(base)
	if rel == "" || rel == "." {
		return base
	}
	joined := path.Join(base, filepath.ToSlash(rel))
	return normalizeRemotePath(joined)
}

func normalizeRemotePath(p string) string {
	if p == "" || p == "/" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return path.Clean(p)
}

func remoteIsDir(conn *ftp.ServerConn, remote string) (bool, error) {
	if _, err := conn.FileSize(remote); err == nil {
		return false, nil
	}
	entries, err := conn.List(remote)
	if err != nil {
		return false, fmt.Errorf("remote path %q: %w", remote, err)
	}
	if len(entries) == 1 {
		switch entries[0].Type {
		case ftp.EntryTypeFolder:
			return true, nil
		case ftp.EntryTypeFile:
			return false, nil
		}
	}
	return true, nil
}

func collectLocalFiles(root string) ([]localFile, int64, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, 0, err
	}
	if !info.IsDir() {
		return []localFile{{local: root, rel: filepath.Base(root), size: info.Size()}}, info.Size(), nil
	}

	root = filepath.Clean(root)
	files := make([]localFile, 0, 32)
	var total int64
	err = filepath.WalkDir(root, func(fullPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		st, statErr := entry.Info()
		if statErr != nil {
			return statErr
		}
		rel, relErr := filepath.Rel(root, fullPath)
		if relErr != nil {
			return relErr
		}
		size := st.Size()
		files = append(files, localFile{local: fullPath, rel: rel, size: size})
		total += size
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func collectRemoteFiles(conn *ftp.ServerConn, root string) ([]remoteFile, int64, error) {
	root = normalizeRemotePath(root)
	isDir, err := remoteIsDir(conn, root)
	if err != nil {
		return nil, 0, err
	}
	if !isDir {
		size := int64(0)
		if n, sizeErr := conn.FileSize(root); sizeErr == nil {
			size = n
		}
		return []remoteFile{{remote: root, rel: path.Base(root), size: size}}, size, nil
	}

	files := make([]remoteFile, 0, 32)
	var total int64
	walker := conn.Walk(root)
	for walker.Next() {
		entry := walker.Stat()
		if entry == nil || entry.Type != ftp.EntryTypeFile {
			continue
		}
		remotePath := normalizeRemotePath(walker.Path())
		rel, relErr := filepath.Rel(filepath.FromSlash(root), filepath.FromSlash(remotePath))
		if relErr != nil {
			return nil, 0, relErr
		}
		size := int64(entry.Size)
		files = append(files, remoteFile{remote: remotePath, rel: rel, size: size})
		total += size
	}
	if err := walker.Err(); err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func isUnderPath(base, target string) bool {
	base = normalizeRemotePath(base)
	target = normalizeRemotePath(target)
	return target == base || strings.HasPrefix(target, base+"/")
}

// mkdirRemote 创建单级远程目录；已存在则忽略。绝对路径失败时回退为 CWD 到父目录再相对 MKD。
func mkdirRemote(conn *ftp.ServerConn, dir string) error {
	dir = normalizeRemotePath(dir)
	if dir == "/" {
		return nil
	}
	absErr := conn.MakeDir(dir)
	if absErr == nil || isRemoteDirExists(absErr) {
		return nil
	}

	parent := path.Dir(dir)
	name := path.Base(dir)
	if name == "." || name == "/" {
		return fmt.Errorf(errFmtMkdirRemote, dir, absErr)
	}
	parent = normalizeRemotePath(parent)

	pwd, _ := conn.CurrentDir()
	defer func() {
		if pwd != "" {
			_ = conn.ChangeDir(pwd)
		}
	}()

	if parent != "/" {
		if cwdErr := conn.ChangeDir(parent); cwdErr != nil {
			return fmt.Errorf(errFmtMkdirRemote, dir, absErr)
		}
	}
	if mkErr := conn.MakeDir(name); mkErr != nil {
		if isRemoteDirExists(mkErr) {
			return nil
		}
		return fmt.Errorf(errFmtMkdirRemote, dir, mkErr)
	}
	return nil
}

// ensureRemoteDirUnderBase 在已存在的 base 目录下递归创建 target（含 base 本身），不从 FTP 根路径逐级 MKD。
func ensureRemoteDirUnderBase(conn *ftp.ServerConn, base, target string) error {
	base = normalizeRemotePath(base)
	target = normalizeRemotePath(target)
	if target == base {
		return mkdirRemote(conn, base)
	}
	if !isUnderPath(base, target) {
		return fmt.Errorf("remote dir %q is outside upload base %q", target, base)
	}
	rel := strings.TrimPrefix(target, base)
	rel = strings.TrimPrefix(rel, "/")
	if rel == "" {
		return mkdirRemote(conn, base)
	}
	cur := base
	for _, part := range strings.Split(rel, "/") {
		if part == "" {
			continue
		}
		cur = remotePathJoin(cur, part)
		if err := mkdirRemote(conn, cur); err != nil {
			return err
		}
	}
	return nil
}

func isRemoteDirExists(err error) bool {
	if err == nil {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "exists") ||
		strings.Contains(msg, "file exists") ||
		strings.Contains(msg, "already") ||
		strings.Contains(msg, "550 directory") ||
		strings.Contains(msg, "521")
}

func (m *Manager) uploadDir(ctx context.Context, lease *ConnLease, t *task) error {
	files, total, err := collectLocalFiles(t.LocalPath)
	if err != nil {
		return fmt.Errorf("scan local dir: %w", err)
	}
	if err := retryVoid(ctx, lease, func() error {
		return mkdirRemote(lease.Conn, t.RemotePath)
	}); err != nil {
		return err
	}
	m.setTotal(t, total)

	var transferred int64
	for _, file := range files {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		remotePath := remotePathJoin(t.RemotePath, file.rel)
		if err := retryVoid(ctx, lease, func() error {
			return ensureRemoteDirUnderBase(lease.Conn, t.RemotePath, path.Dir(remotePath))
		}); err != nil {
			return err
		}
		n, err := retryOnConnLost(ctx, lease, func() (int64, error) {
			return m.uploadFile(ctx, lease.Conn, t, file.local, remotePath, transferred, file.size)
		})
		if err != nil {
			return err
		}
		transferred += n
	}
	m.setProgress(t, transferred, total, 0)
	return nil
}

func (m *Manager) downloadDir(ctx context.Context, lease *ConnLease, t *task) error {
	var files []remoteFile
	var total int64
	if err := retryVoid(ctx, lease, func() error {
		var listErr error
		files, total, listErr = collectRemoteFiles(lease.Conn, t.RemotePath)
		return listErr
	}); err != nil {
		return fmt.Errorf("scan remote dir: %w", err)
	}
	m.setTotal(t, total)

	var transferred int64
	for _, file := range files {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		localPath := filepath.Join(t.LocalPath, filepath.FromSlash(file.rel))
		if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
			return fmt.Errorf("mkdir local: %w", err)
		}
		n, err := retryOnConnLost(ctx, lease, func() (int64, error) {
			return m.downloadFile(ctx, lease.Conn, t, file.remote, localPath, transferred, file.size)
		})
		if err != nil {
			return err
		}
		transferred += n
	}
	m.setProgress(t, transferred, total, 0)
	return nil
}

func (m *Manager) uploadFile(
	ctx context.Context,
	conn *ftp.ServerConn,
	t *task,
	localPath string,
	remotePath string,
	baseTransferred int64,
	fileTotal int64,
) (int64, error) {
	in, err := os.Open(localPath)
	if err != nil {
		return 0, fmt.Errorf("open local: %w", err)
	}
	defer in.Close()

	pr, pw := io.Pipe()
	copyErr := make(chan error, 1)
	go func() {
		err := m.copyWithProgress(ctx, t, in, pw, baseTransferred)
		_ = pw.Close()
		copyErr <- err
	}()

	if err := conn.Stor(remotePath, pr); err != nil {
		_ = pr.Close()
		return 0, fmt.Errorf("stor %q: %w", remotePath, err)
	}
	if err := <-copyErr; err != nil {
		return 0, err
	}
	return fileTotal, nil
}

func (m *Manager) downloadFile(
	ctx context.Context,
	conn *ftp.ServerConn,
	t *task,
	remotePath string,
	localPath string,
	baseTransferred int64,
	fileTotal int64,
) (int64, error) {
	resp, err := conn.Retr(remotePath)
	if err != nil {
		return 0, fmt.Errorf("retr %q: %w", remotePath, err)
	}
	defer resp.Close()

	if fileTotal <= 0 {
		if size, sizeErr := conn.FileSize(remotePath); sizeErr == nil {
			fileTotal = size
		}
	}

	out, err := os.Create(localPath)
	if err != nil {
		return 0, fmt.Errorf("create local: %w", err)
	}
	defer out.Close()

	if err := m.copyWithProgress(ctx, t, resp, out, baseTransferred); err != nil {
		return 0, err
	}
	if fileTotal <= 0 {
		if st, statErr := out.Stat(); statErr == nil {
			fileTotal = st.Size()
		}
	}
	return fileTotal, nil
}
