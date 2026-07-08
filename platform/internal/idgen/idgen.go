// Package idgen 提供 Platform 应用层的唯一 ID 生成能力。
//
// 数据库规范要求主键为应用层生成的十进制字符串（TEXT），禁止数据库自增
// （见 .cursor/rules/database-schema.mdc）。本包实现 Snowflake 算法：
// 41 位毫秒时间戳 + 10 位 worker + 12 位序列。桌面端单进程用 worker=0 即可，
// 生成的 ID 全局单调递增、可读、可排序。
package idgen

import (
	"errors"
	"strconv"
	"sync"
	"time"
)

const (
	// workerBits 是 worker ID 占用的位数。
	workerBits = 10
	// sequenceBits 是同一毫秒内序列号占用的位数。
	sequenceBits = 12
	// maxWorkerID 是 worker ID 的最大取值。
	maxWorkerID = (1 << workerBits) - 1
	// maxSequence 是同一毫秒内序列号的最大取值（用于回绕掩码）。
	maxSequence = (1 << sequenceBits) - 1
	// timestampShift 是时间戳部分的左移位数。
	timestampShift = workerBits + sequenceBits
	// workerShift 是 worker 部分的左移位数。
	workerShift = sequenceBits
	// epochMillisecond 是自定义纪元 2024-01-01 UTC（毫秒），压缩时间戳位宽。
	epochMillisecond int64 = 1704067200000
)

// ErrWorkerIDOutOfRange 表示 worker ID 超出 [0, maxWorkerID] 范围。
var ErrWorkerIDOutOfRange = errors.New("idgen: worker id out of range")

// ErrClockBackwards 表示检测到系统时钟回拨，暂时无法安全生成 ID。
var ErrClockBackwards = errors.New("idgen: clock moved backwards")

// Generator 签发全局唯一 ID。
type Generator interface {
	// NextID 返回下一个唯一的 64 位 ID。
	NextID() (int64, error)
	// NextString 返回下一个唯一 ID 的十进制字符串形式（用作 TEXT 主键）。
	NextString() (string, error)
}

// Snowflake 实现 Generator 接口，并发安全。
type Snowflake struct {
	mu        sync.Mutex
	workerID  int64
	lastMilli int64
	sequence  int64
}

// NewSnowflake 为指定 worker ID 创建 Snowflake 生成器。
func NewSnowflake(workerID int64) (*Snowflake, error) {
	if workerID < 0 || workerID > maxWorkerID {
		return nil, ErrWorkerIDOutOfRange
	}
	return &Snowflake{workerID: workerID}, nil
}

// NextID 返回下一个唯一 ID；检测到时钟回拨时返回 ErrClockBackwards。
func (s *Snowflake) NextID() (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UnixMilli()
	if now < s.lastMilli {
		return 0, ErrClockBackwards
	}
	if now == s.lastMilli {
		s.sequence = (s.sequence + 1) & maxSequence
		if s.sequence == 0 {
			// 当前毫秒序列耗尽，自旋等待到下一毫秒。
			for now <= s.lastMilli {
				now = time.Now().UnixMilli()
			}
		}
	} else {
		s.sequence = 0
	}
	s.lastMilli = now

	id := ((now - epochMillisecond) << timestampShift) |
		(s.workerID << workerShift) |
		s.sequence
	return id, nil
}

// NextString 返回 NextID 结果的十进制字符串形式。
func (s *Snowflake) NextString() (string, error) {
	id, err := s.NextID()
	if err != nil {
		return "", err
	}
	return strconv.FormatInt(id, 10), nil
}
