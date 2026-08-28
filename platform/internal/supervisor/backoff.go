package supervisor

import "time"

const (
	minRestartDelay    = time.Second
	maxRestartDelay    = 30 * time.Second
	restartStableAfter = 60 * time.Second
)

// nextRestartDelay 计算崩溃后的退避间隔。
// lived 为本次进程存活时长；稳定运行后重置为最小值。
func nextRestartDelay(prev, lived time.Duration) time.Duration {
	if lived >= restartStableAfter {
		return minRestartDelay
	}
	if prev <= 0 {
		return minRestartDelay
	}
	next := prev * 2
	if next > maxRestartDelay {
		return maxRestartDelay
	}
	return next
}
