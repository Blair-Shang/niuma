package loop

import "testing"

func TestDefersWork(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    bool
	}{
		{
			name:    "promises another round",
			content: "执行 Tomcat 重启。先关闭 + 启动，下一轮等待启动完成 + 验证。",
			want:    true,
		},
		{
			name:    "asks to reply execute",
			content: "确认就回「执行」。",
			want:    true,
		},
		{
			name:    "finished report",
			content: "修复完成，全部验证通过。需要的话可以再看日志。",
			want:    false,
		},
		{
			name:    "optional follow-up",
			content: "要修就告诉我修哪种。",
			want:    false,
		},
		{
			name:    "marker only inside thinking",
			content: "<think>下一轮再验证</think>\n修复已经完成。",
			want:    false,
		},
		{
			name:    "empty",
			content: "  ",
			want:    false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := defersWork(tc.content); got != tc.want {
				t.Fatalf("defersWork(%q) = %v, want %v", tc.content, got, tc.want)
			}
		})
	}
}
