package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
)

const maxCommandInputBytes = 64 * 1024

var staticSuggestions = []string{
	"show dbs",
	"show databases",
	"use admin",
	"db.stats()",
	`{ "serverStatus": 1 }`,
	`{ "currentOp": 1, "active": true }`,
	`{ "buildInfo": 1 }`,
	`{ "hostInfo": 1 }`,
}

// CommandResult 是 command.exec 返回结构。
type CommandResult struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

// ExecCommand 在内置 REPL 中执行输入（驱动层 runCommand，非 mongosh）。
func ExecCommand(ctx context.Context, s *Session, input string) (*CommandResult, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return &CommandResult{}, nil
	}
	if len(input) > maxCommandInputBytes {
		return nil, fmt.Errorf("input exceeds 64 KiB limit")
	}

	lower := strings.ToLower(input)
	switch {
	case lower == "show dbs" || lower == "show databases":
		dbs, err := ListDatabases(ctx, s.Client)
		if err != nil {
			return &CommandResult{Error: err.Error()}, nil
		}
		var b strings.Builder
		for _, db := range dbs {
			fmt.Fprintf(&b, "%s\t%db\n", db.Name, db.SizeOnDisk)
		}
		return &CommandResult{Output: strings.TrimRight(b.String(), "\n")}, nil
	case strings.HasPrefix(lower, "use "):
		db := strings.TrimSpace(input[4:])
		if db == "" {
			return &CommandResult{Error: "database name required"}, nil
		}
		s.SetDatabase(db)
		return &CommandResult{Output: fmt.Sprintf("switched to db %s", db)}, nil
	case lower == "db.stats()":
		var result bson.M
		err := s.Client.Database(s.ActiveDatabase()).RunCommand(ctx, bson.D{{Key: "dbStats", Value: 1}}).Decode(&result)
		if err != nil {
			return &CommandResult{Error: err.Error()}, nil
		}
		raw, err := MarshalDocument(result)
		if err != nil {
			return &CommandResult{Error: err.Error()}, nil
		}
		return &CommandResult{Output: string(raw)}, nil
	}

	var cmd bson.M
	if err := bson.UnmarshalExtJSON([]byte(input), true, &cmd); err != nil {
		return &CommandResult{Error: fmt.Sprintf("parse command: %v", err)}, nil
	}
	db := commandDatabase(cmd, s.ActiveDatabase())
	var result bson.M
	if err := s.Client.Database(db).RunCommand(ctx, cmd).Decode(&result); err != nil {
		return &CommandResult{Error: err.Error()}, nil
	}
	raw, err := MarshalDocument(result)
	if err != nil {
		return &CommandResult{Error: err.Error()}, nil
	}
	return &CommandResult{Output: string(raw)}, nil
}

func commandDatabase(cmd bson.M, fallback string) string {
	for _, adminCmd := range []string{"serverStatus", "currentOp", "buildInfo", "hostInfo", "listDatabases"} {
		if _, ok := cmd[adminCmd]; ok {
			return "admin"
		}
	}
	return fallback
}

// SuggestCommands 返回与输入前缀匹配的命令建议。
func SuggestCommands(input string) []string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		out := make([]string, len(staticSuggestions))
		copy(out, staticSuggestions)
		return out
	}
	lower := strings.ToLower(trimmed)
	out := make([]string, 0)
	for _, item := range staticSuggestions {
		if strings.HasPrefix(strings.ToLower(item), lower) {
			out = append(out, item)
		}
	}
	return out
}

// SuggestCommandsJSON 供 handler 返回 JSON 数组。
func SuggestCommandsJSON(input string) json.RawMessage {
	items := SuggestCommands(input)
	raw, _ := json.Marshal(map[string]any{"suggestions": items})
	return raw
}
