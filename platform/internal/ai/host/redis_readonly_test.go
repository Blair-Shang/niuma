package host

import "testing"

func TestAssertReadonlyRedis(t *testing.T) {
	cases := []struct {
		args []string
		ok   bool
	}{
		{[]string{"GET", "foo"}, true},
		{[]string{"TYPE", "foo"}, true},
		{[]string{"TTL", "foo"}, true},
		{[]string{"HGETALL", "h"}, true},
		{[]string{"LRANGE", "l", "0", "-1"}, true},
		{[]string{"SCAN", "0", "MATCH", "user:*"}, true},
		{[]string{"INFO", "memory"}, true},
		{[]string{"SLOWLOG", "GET", "10"}, true},
		{[]string{"SLOWLOG", "LEN"}, true},
		{[]string{"CONFIG", "GET", "maxmemory"}, true},
		{[]string{"COMMAND"}, true},
		{[]string{"OBJECT", "ENCODING", "k"}, true},
		{[]string{"SET", "foo", "bar"}, false},
		{[]string{"DEL", "foo"}, false},
		{[]string{"FLUSHDB"}, false},
		{[]string{"KEYS", "*"}, false},
		{[]string{"SELECT", "2"}, false},
		{[]string{"SLOWLOG", "RESET"}, false},
		{[]string{"CONFIG", "SET", "maxmemory", "1mb"}, false},
		{[]string{"MONITOR"}, false},
		{[]string{"SUBSCRIBE", "ch"}, false},
		{[]string{}, false},
	}
	for _, tc := range cases {
		err := AssertReadonlyRedis(tc.args)
		if tc.ok && err != nil {
			t.Fatalf("%v: %v", tc.args, err)
		}
		if !tc.ok && err == nil {
			t.Fatalf("%v: want error", tc.args)
		}
	}
}
