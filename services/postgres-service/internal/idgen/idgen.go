// Package idgen 为 postgres-service 提供会话 ID、调试 ID 等应用层唯一标识生成。
package idgen

import (
	"errors"
	"strconv"
	"sync"
	"time"
)

const (
	workerBits             = 10
	sequenceBits           = 12
	maxWorkerID            = (1 << workerBits) - 1
	maxSequence            = (1 << sequenceBits) - 1
	timestampShift         = workerBits + sequenceBits
	workerShift            = sequenceBits
	epochMillisecond int64 = 1704067200000 // 2024-01-01 UTC, milliseconds
)

var (
	// ErrWorkerIDOutOfRange 表示 worker ID 超出可分配范围。
	ErrWorkerIDOutOfRange = errors.New("idgen: worker id out of range")
	// ErrClockBackwards 表示系统时钟回拨，无法继续签发 ID。
	ErrClockBackwards = errors.New("idgen: clock moved backwards")
)

// Generator 签发全局唯一 ID。
type Generator interface {
	NextID() (int64, error)
	NextString() (string, error)
}

// Snowflake 实现 Generator 接口。
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

// NextID 返回下一个唯一 ID。
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

// NextString 返回十进制字符串形式的下一个唯一 ID。
func (s *Snowflake) NextString() (string, error) {
	id, err := s.NextID()
	if err != nil {
		return "", err
	}
	return strconv.FormatInt(id, 10), nil
}
