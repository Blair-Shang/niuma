package host

import (
	"fmt"
	"strings"
)

// redisReadonlyExact 是无子命令即可只读执行的命令（第一道滤网，不是 ACL）。
var redisReadonlyExact = map[string]struct{}{
	"GET": {}, "MGET": {}, "GETRANGE": {}, "GETBIT": {}, "STRLEN": {}, "SUBSTR": {},
	"EXISTS": {}, "TYPE": {}, "TTL": {}, "PTTL": {}, "EXPIRETIME": {}, "PEXPIRETIME": {},
	"DUMP": {}, "DBSIZE": {}, "PING": {}, "ECHO": {}, "TIME": {}, "LASTSAVE": {},
	"ROLE": {}, "LOLWUT": {}, "INFO": {}, "SCAN": {},
	"HGET": {}, "HMGET": {}, "HGETALL": {}, "HKEYS": {}, "HVALS": {}, "HLEN": {},
	"HEXISTS": {}, "HSTRLEN": {}, "HRANDFIELD": {}, "HSCAN": {},
	"LINDEX": {}, "LLEN": {}, "LRANGE": {}, "LPOS": {},
	"SCARD": {}, "SISMEMBER": {}, "SMISMEMBER": {}, "SMEMBERS": {}, "SRANDMEMBER": {},
	"SSCAN": {}, "SINTER": {}, "SUNION": {}, "SDIFF": {},
	"ZCARD": {}, "ZCOUNT": {}, "ZRANGE": {}, "ZREVRANGE": {}, "ZRANGEBYSCORE": {},
	"ZREVRANGEBYSCORE": {}, "ZRANGEBYLEX": {}, "ZREVRANGEBYLEX": {}, "ZRANK": {},
	"ZREVRANK": {}, "ZSCORE": {}, "ZMSCORE": {}, "ZSCAN": {},
	"XLEN": {}, "XRANGE": {}, "XREVRANGE": {},
	"BITCOUNT": {}, "BITPOS": {}, "PFCOUNT": {},
	"GEOSEARCH": {}, "GEOPOS": {}, "GEODIST": {}, "GEOHASH": {},
	"JSON.GET": {}, "JSON.TYPE": {}, "JSON.STRLEN": {}, "JSON.OBJKEYS": {}, "JSON.OBJLEN": {},
	"JSON.ARRLEN": {}, "JSON.MGET": {},
	"FT.INFO": {}, "FT.SEARCH": {}, "FT._LIST": {}, "FT.EXPLAIN": {},
}

// redisReadonlySub 是必须带子命令且仅允许列出子命令的只读入口。
var redisReadonlySub = map[string]map[string]struct{}{
	"SLOWLOG": {"GET": {}, "LEN": {}},
	"CONFIG":  {"GET": {}},
	"ACL":     {"GETUSER": {}, "LIST": {}, "WHOAMI": {}, "CAT": {}, "LOG": {}, "DRYRUN": {}},
	"CLIENT":  {"LIST": {}, "INFO": {}, "ID": {}, "GETNAME": {}},
	"COMMAND": {"": {}, "COUNT": {}, "DOCS": {}, "INFO": {}, "GETKEYS": {}, "LIST": {}, "HELP": {}},
	"CLUSTER": {
		"INFO": {}, "NODES": {}, "SLOTS": {}, "SHARDS": {}, "KEYSLOT": {},
		"GETKEYSINSLOT": {}, "COUNTKEYSINSLOT": {}, "MYID": {}, "MYSHARDID": {},
	},
	"SCRIPT":   {"EXISTS": {}, "SHOW": {}, "HELP": {}},
	"MEMORY":   {"USAGE": {}, "STATS": {}, "DOCTOR": {}, "MALLOC-STATS": {}, "HELP": {}},
	"OBJECT":   {"ENCODING": {}, "IDLETIME": {}, "REFCOUNT": {}, "FREQ": {}, "HELP": {}},
	"XINFO":    {"STREAM": {}, "GROUPS": {}, "CONSUMERS": {}, "HELP": {}},
	"LATENCY":  {"LATEST": {}, "HISTORY": {}, "GRAPH": {}, "DOCTOR": {}, "HELP": {}},
	"MODULE":   {"LIST": {}},
	"FUNCTION": {"LIST": {}, "STATS": {}, "HELP": {}},
}

// AssertReadonlyRedis 拒绝写命令、KEYS、SELECT 与长连接订阅。
// 这是第一道滤网；写操作走 redis_exec 并经用户确认。
func AssertReadonlyRedis(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("args or command required")
	}
	cmd := strings.ToUpper(strings.TrimSpace(args[0]))
	if cmd == "" {
		return fmt.Errorf("args or command required")
	}
	if err := rejectLongLivedRedis(cmd); err != nil {
		return err
	}
	if cmd == "KEYS" {
		return fmt.Errorf("KEYS rejected; use redis_scan_keys or SCAN")
	}
	if cmd == "SELECT" {
		return fmt.Errorf("SELECT changes the session; switch the Redis DB in the tab")
	}
	if _, ok := redisReadonlyExact[cmd]; ok {
		return nil
	}
	allowed, ok := redisReadonlySub[cmd]
	if !ok {
		return fmt.Errorf("only read commands are allowed; use redis_exec after user confirmation")
	}
	sub := ""
	if len(args) > 1 {
		sub = strings.ToUpper(strings.TrimSpace(args[1]))
	}
	if _, ok := allowed[sub]; ok {
		return nil
	}
	return fmt.Errorf("%s %s is not read-only; use redis_exec after user confirmation", cmd, sub)
}

func rejectLongLivedRedis(cmd string) error {
	switch cmd {
	case "MONITOR", "PSYNC", "SYNC", "SUBSCRIBE", "PSUBSCRIBE", "SSUBSCRIBE":
		return fmt.Errorf("%s is long-lived; use the Redis MONITOR pane, not redis tools", cmd)
	default:
		return nil
	}
}
