// Package backup 使用 SQLite Online Backup API（modernc NewBackup）安全拷贝库文件。
package backup

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
)

// ProgressFunc 上报进度。
type ProgressFunc func(pagesCopied int64, message string)

// CopyFile 将 srcDB 在线备份到 destPath。
// 通过反射调用 modernc.org/sqlite 驱动连接上的 NewBackup，避免依赖未导出 *conn 类型。
func CopyFile(ctx context.Context, srcDB *sql.DB, destPath string, onProgress ProgressFunc) error {
	if srcDB == nil {
		return fmt.Errorf("sqlite: backup: nil db")
	}
	destPath = strings.TrimSpace(destPath)
	if destPath == "" {
		return fmt.Errorf("sqlite: backup: dest path required")
	}
	abs, err := filepath.Abs(destPath)
	if err != nil {
		return fmt.Errorf("sqlite: backup: resolve path: %w", err)
	}
	// modernc NewBackup 接受 URI / 路径；Windows 用斜杠更稳妥
	destURI := filepath.ToSlash(abs)

	conn, err := srcDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("sqlite: backup: conn: %w", err)
	}
	defer conn.Close()

	var pages int64
	err = conn.Raw(func(driverConn any) error {
		v := reflect.ValueOf(driverConn)
		m := v.MethodByName("NewBackup")
		if !m.IsValid() {
			return fmt.Errorf("sqlite: backup: driver does not support NewBackup (%T)", driverConn)
		}
		outs := m.Call([]reflect.Value{reflect.ValueOf(destURI)})
		if len(outs) != 2 {
			return fmt.Errorf("sqlite: backup: unexpected NewBackup signature")
		}
		if !outs[1].IsNil() {
			return fmt.Errorf("sqlite: backup: init: %v", outs[1].Interface())
		}
		bk := outs[0]
		if bk.IsNil() {
			return fmt.Errorf("sqlite: backup: nil backup handle")
		}
		step := bk.MethodByName("Step")
		finish := bk.MethodByName("Finish")
		if !step.IsValid() || !finish.IsValid() {
			return fmt.Errorf("sqlite: backup: incomplete Backup API")
		}

		runFinish := func() error {
			fres := finish.Call(nil)
			if len(fres) > 0 && !fres[0].IsNil() {
				return fres[0].Interface().(error)
			}
			return nil
		}

		const pagesPerStep int32 = 100
		for {
			if err := ctx.Err(); err != nil {
				_ = runFinish()
				return err
			}
			sres := step.Call([]reflect.Value{reflect.ValueOf(pagesPerStep)})
			if len(sres) != 2 {
				_ = runFinish()
				return fmt.Errorf("sqlite: backup: unexpected Step signature")
			}
			if !sres[1].IsNil() {
				_ = runFinish()
				return fmt.Errorf("sqlite: backup: step: %v", sres[1].Interface())
			}
			more := sres[0].Bool()
			pages += int64(pagesPerStep)
			if onProgress != nil {
				onProgress(pages, fmt.Sprintf("copied ~%d pages", pages))
			}
			if !more {
				return runFinish()
			}
		}
	})
	return err
}
