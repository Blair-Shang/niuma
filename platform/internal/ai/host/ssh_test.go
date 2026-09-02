package host

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type sshStubRuntime struct {
	lastMethod string
	lastParams map[string]any
}

func (s *sshStubRuntime) Call(_ context.Context, method string, params map[string]any) (json.RawMessage, error) {
	s.lastMethod = method
	s.lastParams = params
	switch method {
	case "ssh.sftp.dir.list":
		return json.RawMessage(`{"path":"/home/ops","entries":[{"name":"a.txt","kind":"file","size":12}]}`), nil
	case "ssh.sftp.file.read":
		return json.RawMessage(`{"path":"/etc/os-release","content":"NAME=linux\n","size":11}`), nil
	case "ssh.monitor.metrics":
		return json.RawMessage(`{"cpuUsage":12.5,"cpuCores":4,"memTotal":8000,"disks":[{"mountpoint":"/"}],"topProcesses":[{"pid":1,"name":"systemd"}]}`), nil
	case "ssh.monitor.process.inspect":
		return json.RawMessage(`{"pid":1,"name":"systemd","cmdline":"/sbin/init"}`), nil
	case "ssh.exec.run":
		return json.RawMessage(`{"stdout":"ok\n","stderr":"","exitCode":0}`), nil
	default:
		return json.RawMessage(`{}`), nil
	}
}

func (s *sshStubRuntime) KindOf(_ context.Context, _ string) (string, error) {
	return "ssh", nil
}

func TestIsSSHTool(t *testing.T) {
	if !IsSSHTool(ToolSSHListDir) || IsSSHTool("list_dir") || IsSQLTool(ToolSSHExec) {
		t.Fatal("ssh_* only")
	}
}

func TestHostToolSpecsByModule(t *testing.T) {
	ssh := HostToolSpecs("ssh")
	if len(ssh) != 5 {
		t.Fatalf("ssh specs=%d", len(ssh))
	}
	for _, spec := range ssh {
		if !IsSSHTool(spec.Name) {
			t.Fatalf("unexpected %s", spec.Name)
		}
	}
	sql := HostToolSpecs("vastbase")
	if len(sql) != 4 {
		t.Fatalf("sql specs=%d", len(sql))
	}
	both := HostToolSpecs("")
	if len(both) != 9 {
		t.Fatalf("both specs=%d", len(both))
	}
}

func TestCallSSHListDir(t *testing.T) {
	rt := &sshStubRuntime{}
	text, err := CallSSH(context.Background(), rt, ToolSSHListDir, map[string]any{
		"sessionId": "s1",
		"path":      "/home/ops",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "a.txt") {
		t.Fatalf("result: %s", text)
	}
	if rt.lastMethod != "ssh.sftp.dir.list" {
		t.Fatalf("method=%s", rt.lastMethod)
	}
}

func TestCallSSHExecRequiresCommand(t *testing.T) {
	_, err := CallSSH(context.Background(), &sshStubRuntime{}, ToolSSHExec, map[string]any{
		"sessionId": "s1",
	})
	if err == nil {
		t.Fatal("expected command required")
	}
}

func TestCallSSHRequiresLiveSession(t *testing.T) {
	_, err := Call(context.Background(), &sshStubRuntime{}, ToolSSHReadFile, map[string]any{
		"profileId": "p1",
		"path":      "/etc/os-release",
	})
	if err == nil || !strings.Contains(err.Error(), "sessionId required") {
		t.Fatalf("want sessionId required, got %v", err)
	}
}

func TestCallSSHExec(t *testing.T) {
	rt := &sshStubRuntime{}
	text, err := CallSSH(context.Background(), rt, ToolSSHExec, map[string]any{
		"sessionId": "s1",
		"command":   "uname -a",
	})
	if err != nil {
		t.Fatal(err)
	}
	if stream, ok := rt.lastParams["stream"].(bool); !ok || stream {
		t.Fatalf("exec must be non-stream: %+v", rt.lastParams)
	}
	if !strings.Contains(text, `"exitCode": 0`) {
		t.Fatalf("result: %s", text)
	}
}
