// Package idgen 为 ftp-service 提供会话 ID 等应用层唯一标识生成。
package idgen

import (
	"errors"
	"strconv"
	"sync"
	"time"
)

const (
	workerBits       = 10
	sequenceBits     = 12
	maxWorkerID      = (1 << workerBits) - 1
	maxSequence      = (1 << sequenceBits) - 1
	timestampShift   = workerBits + sequenceBits
	workerShift      = sequenceBits
	epochMillisecond int64 = 1704067200000
)

var (
	ErrWorkerIDOutOfRange = errors.New("idgen: worker id out of range")
	ErrClockBackwards     = errors.New("idgen: clock moved backwards")
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

// NewSnowflake 创建 Snowflake 生成器。
func NewSnowflake(workerID int64) (*Snowflake, error) {
	if workerID < 0 || workerID > maxWorkerID {
		return nil, ErrWorkerIDOutOfRange
	}
	return &Snowflake{workerID: workerID}, nil
}

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

func (s *Snowflake) NextString() (string, error) {
	id, err := s.NextID()
	if err != nil {
		return "", err
	}
	return strconv.FormatInt(id, 10), nil
}
