// Package idgen provides snowflake identifiers for dameng-service.
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
	epochMillisecond int64 = 1704067200000
)

var (
	ErrWorkerIDOutOfRange = errors.New("idgen: worker id out of range")
	ErrClockBackwards     = errors.New("idgen: clock moved backwards")
)

type Generator interface {
	NextID() (int64, error)
	NextString() (string, error)
}
type Snowflake struct {
	mu                            sync.Mutex
	workerID, lastMilli, sequence int64
}

func NewSnowflake(id int64) (*Snowflake, error) {
	if id < 0 || id > maxWorkerID {
		return nil, ErrWorkerIDOutOfRange
	}
	return &Snowflake{workerID: id}, nil
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
	return ((now - epochMillisecond) << timestampShift) | (s.workerID << workerShift) | s.sequence, nil
}
func (s *Snowflake) NextString() (string, error) {
	n, e := s.NextID()
	return strconv.FormatInt(n, 10), e
}
