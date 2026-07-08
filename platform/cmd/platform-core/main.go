// Command platform-core 是 NiuMa Platform 层（Layer 2）的常驻进程入口。
//
// 职责：解析本地 SQLite 库路径 → 打开库并启用 WAL → 执行结构迁移 →
// 在应用 IPC 地址（Windows 命名管道 / 其他平台 UDS）上提供服务，处理来自
// C++ 壳层透传过来的 platform.* 请求，直到进程被终止。
//
// 壳层不含任何业务逻辑：持久化与方法裁决全部发生在本进程。
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"niuma/platform/internal/eventhub"
	"niuma/platform/internal/handler"
	"niuma/pkg/buildinfo"
	"niuma/pkg/logutil"
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/migrate"
	"niuma/platform/internal/server"
	"niuma/platform/internal/store"
	"niuma/platform/internal/supervisor"

	_ "modernc.org/sqlite"
)

const (
	// dbFileName 是本地库文件名。
	dbFileName = "niuma.db"
	// sqliteDriver 是 modernc.org/sqlite 注册的驱动名。
	sqliteDriver = "sqlite"
	// windowsPipeAddr 是 Windows 应用 IPC 命名管道地址，须与壳层保持一致。
	windowsPipeAddr = `\\.\pipe\niuma.platform`
	// unixSocketName 是非 Windows 平台 UDS 文件名。
	unixSocketName = "niuma.platform.sock"
	// defaultWorkerID 是单进程桌面端的 Snowflake worker ID。
	defaultWorkerID = 0
)

func main() {
	if err := logutil.Init("platform-core"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	slog.Info("platform-core starting", "version", buildinfo.Version, "build", buildinfo.BuildID)

	if err := run(); err != nil {
		slog.Error("platform-core exited", "err", err)
		os.Exit(1)
	}
}

// run 组装依赖并启动服务，返回时表示进程应退出。
func run() error {
	dbPath, err := resolveDBPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return fmt.Errorf("platform: create data dir: %w", err)
	}

	db, err := openDatabase(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	// 进程收到中断信号时取消 ctx，触发服务端优雅关闭。
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := migrate.Run(ctx, db); err != nil {
		return err
	}
	slog.Info("database ready", "path", dbPath)

	idGen, err := idgen.NewSnowflake(defaultWorkerID)
	if err != nil {
		return fmt.Errorf("platform: init id generator: %w", err)
	}

	installDir, err := supervisor.ResolveServicesDir()
	if err != nil {
		slog.Warn("capability services lazy start may fail", "err", err)
	}
	var capabilities *handler.CapabilityRegistry
	var sup *supervisor.Supervisor
	if installDir != "" {
		if s, supErr := supervisor.New(installDir); supErr != nil {
			slog.Warn("supervisor init failed", "err", supErr)
		} else {
			sup = s
			defer sup.Shutdown()
			if reg, regErr := handler.NewCapabilityRegistry(sup); regErr != nil {
				slog.Warn("capability registry init failed", "err", regErr)
			} else {
				capabilities = reg
			}
		}
	}

	eventHub := eventhub.New()
	fileEditor := handler.NewFileEditorCoordinator(eventHub)

	dispatcher := handler.New(handler.Deps{
		Settings:     store.NewSettingStore(db),
		Connections:  store.NewConnectionStore(db),
		Credentials:  store.NewCredentialStore(db),
		Secrets:      store.NewKeychainStore(),
		IDs:          idGen,
		Capabilities: capabilities,
		FileEditor:   fileEditor,
	})
	srv := server.New(ipcAddress(), dispatcher)
	go func() {
		if err := eventHub.Serve(ctx); err != nil && ctx.Err() == nil {
			slog.Error("event hub error", "err", err)
		}
	}()
	return srv.Serve(ctx)
}

// openDatabase 打开 SQLite 库并启用适合桌面单文件场景的 PRAGMA。
func openDatabase(dbPath string) (*sql.DB, error) {
	db, err := sql.Open(sqliteDriver, dbPath)
	if err != nil {
		return nil, fmt.Errorf("platform: open sqlite: %w", err)
	}

	// 单连接即可满足配置 KV 的低并发负载，同时彻底规避 WAL 下的写锁竞争。
	db.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA busy_timeout=5000;", // 毫秒
		"PRAGMA foreign_keys=OFF;",  // 本库不使用物理外键
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, fmt.Errorf("platform: apply %q: %w", p, err)
		}
	}
	return db, nil
}

// resolveDBPath 计算本地 SQLite 库的绝对路径。
//
// Windows：%LOCALAPPDATA%\NiuMa\data\niuma.db（与壳层用户数据目录一致）。
// 其他平台：~/.niuma/data/niuma.db；无法确定 HOME 时回退到可执行文件同级的
// data 目录。
func resolveDBPath() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, dbFileName), nil
}

// dataDir 返回用户数据目录（存放 niuma.db 等）。
func dataDir() (string, error) {
	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			return filepath.Join(local, "NiuMa", "data"), nil
		}
		return installFallbackDir()
	}

	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".niuma", "data"), nil
	}
	return installFallbackDir()
}

// installFallbackDir 在无法确定用户目录时，回退到可执行文件同级的 data 目录。
func installFallbackDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("platform: resolve executable dir: %w", err)
	}
	return filepath.Join(filepath.Dir(exe), "data"), nil
}

// ipcAddress 返回本平台的应用 IPC 监听地址。
func ipcAddress() string {
	if runtime.GOOS == "windows" {
		return windowsPipeAddr
	}
	return filepath.Join(os.TempDir(), unixSocketName)
}
