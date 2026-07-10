package tunnel

import (
	"context"
	"encoding/json"
	"testing"
)

func TestInjectSSHProfileNoTunnelReturnsOriginal(t *testing.T) {
	input := json.RawMessage(`{"database":0}`)
	out, err := InjectSSHProfile(context.Background(), input, nil)
	if err != nil {
		t.Fatalf("InjectSSHProfile() error = %v", err)
	}
	if string(out) != string(input) {
		t.Fatalf("InjectSSHProfile() = %s, want %s", out, input)
	}
}

func TestInjectSSHProfile(t *testing.T) {
	input := json.RawMessage(`{"tunnel":{"type":"ssh","sshProfileId":"ssh-1","targetHost":"10.0.0.5","targetPort":6379}}`)
	out, err := InjectSSHProfile(context.Background(), input, ProfileResolverFunc(func(_ context.Context, profileID string) (SSHProfile, error) {
		if profileID != "ssh-1" {
			t.Fatalf("profileID = %q, want ssh-1", profileID)
		}
		return SSHProfile{
			HostAddress:  "jump.example.com",
			PortNumber:   22,
			LoginAccount: "root",
			Secret:       "secret",
			Options:      json.RawMessage(`{"auth_type":"password"}`),
		}, nil
	}))
	if err != nil {
		t.Fatalf("InjectSSHProfile() error = %v", err)
	}

	var got struct {
		Tunnel struct {
			Type       string     `json:"type"`
			SSHProfile SSHProfile `json:"sshProfile"`
		} `json:"tunnel"`
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if got.Tunnel.Type != TypeSSH {
		t.Fatalf("tunnel type = %q, want %q", got.Tunnel.Type, TypeSSH)
	}
	if got.Tunnel.SSHProfile.HostAddress != "jump.example.com" {
		t.Fatalf("hostAddress = %q", got.Tunnel.SSHProfile.HostAddress)
	}
	if string(got.Tunnel.SSHProfile.Options) != `{"auth_type":"password"}` {
		t.Fatalf("options = %s", got.Tunnel.SSHProfile.Options)
	}
}
