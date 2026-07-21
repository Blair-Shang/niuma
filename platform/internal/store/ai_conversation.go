package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// AIConversation 对应 nm_ai_conversation 一行。
type AIConversation struct {
	ConversationID    string
	WorkspaceID       string
	ConversationTitle string
	ProviderID        string
	ModelCode         string
	RowVersion        int64
	CreatedAt         string
	UpdatedAt         string
}

// AIMessage 对应 nm_ai_message 一行。
type AIMessage struct {
	MessageID      string
	ConversationID string
	MessageRole    string
	MessageContent string
	ToolCallID     string
	TokenCount     sql.NullInt64
	CreatedAt      string
}

// AIConversationStore 封装会话与消息表读写。
type AIConversationStore struct {
	db *sql.DB
}

// NewAIConversationStore 基于已打开的 SQLite 连接池创建 AIConversationStore。
func NewAIConversationStore(db *sql.DB) *AIConversationStore {
	return &AIConversationStore{db: db}
}

const aiConversationColumns = `conversation_id, workspace_id, conversation_title, provider_id, model_code,
    row_version, created_at, updated_at`

const aiMessageColumns = `message_id, conversation_id, message_role, message_content, tool_call_id,
    token_count, created_at`

// ListConversations 按更新时间倒序返回会话；limit≤0 时默认 50。
func (s *AIConversationStore) ListConversations(ctx context.Context, limit int) ([]AIConversation, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx,
		"SELECT "+aiConversationColumns+" FROM nm_ai_conversation ORDER BY updated_at DESC LIMIT ?", limit)
	if err != nil {
		return nil, fmt.Errorf("store: list ai conversations: %w", err)
	}
	defer rows.Close()

	var out []AIConversation
	for rows.Next() {
		c, scanErr := scanAIConversation(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list ai conversations rows: %w", err)
	}
	return out, nil
}

// GetConversation 按 ID 读取会话；不存在时返回 (nil, nil)。
func (s *AIConversationStore) GetConversation(ctx context.Context, conversationID string) (*AIConversation, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+aiConversationColumns+" FROM nm_ai_conversation WHERE conversation_id = ?", conversationID)
	var (
		c     AIConversation
		ws    sql.NullString
		title sql.NullString
		prov  sql.NullString
		model sql.NullString
	)
	err := row.Scan(&c.ConversationID, &ws, &title, &prov, &model, &c.RowVersion, &c.CreatedAt, &c.UpdatedAt)
	switch {
	case err == nil:
		c.WorkspaceID = ws.String
		c.ConversationTitle = title.String
		c.ProviderID = prov.String
		c.ModelCode = model.String
		return &c, nil
	case errors.Is(err, sql.ErrNoRows):
		return nil, nil
	default:
		return nil, fmt.Errorf("store: get ai conversation: %w", err)
	}
}

// CreateConversation 插入一条会话。
func (s *AIConversationStore) CreateConversation(ctx context.Context, c AIConversation) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_ai_conversation
        (conversation_id, workspace_id, conversation_title, provider_id, model_code, row_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
		c.ConversationID, nullIfEmpty(c.WorkspaceID), nullIfEmpty(c.ConversationTitle),
		nullIfEmpty(c.ProviderID), nullIfEmpty(c.ModelCode), now, now)
	if err != nil {
		return fmt.Errorf("store: create ai conversation: %w", err)
	}
	return nil
}

// TouchConversation 刷新 updated_at，并可更新标题 / provider / model。
func (s *AIConversationStore) TouchConversation(ctx context.Context, conversationID, title, providerID, modelCode string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `UPDATE nm_ai_conversation SET
        conversation_title = COALESCE(NULLIF(?, ''), conversation_title),
        provider_id = COALESCE(NULLIF(?, ''), provider_id),
        model_code = COALESCE(NULLIF(?, ''), model_code),
        updated_at = ?
        WHERE conversation_id = ?`,
		title, providerID, modelCode, now, conversationID)
	if err != nil {
		return fmt.Errorf("store: touch ai conversation: %w", err)
	}
	return nil
}

// DeleteConversation 物理删除会话及其消息与 tool 调用流水。
func (s *AIConversationStore) DeleteConversation(ctx context.Context, conversationID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin delete conversation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		"DELETE FROM nm_ai_tool_invocation WHERE conversation_id = ?", conversationID); err != nil {
		return fmt.Errorf("store: delete ai invocations: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM nm_ai_message WHERE conversation_id = ?", conversationID); err != nil {
		return fmt.Errorf("store: delete ai messages: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM nm_ai_conversation WHERE conversation_id = ?", conversationID); err != nil {
		return fmt.Errorf("store: delete ai conversation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit delete conversation: %w", err)
	}
	return nil
}

// ListMessages 按创建时间升序返回会话消息。
func (s *AIConversationStore) ListMessages(ctx context.Context, conversationID string) ([]AIMessage, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT "+aiMessageColumns+" FROM nm_ai_message WHERE conversation_id = ? ORDER BY created_at ASC",
		conversationID)
	if err != nil {
		return nil, fmt.Errorf("store: list ai messages: %w", err)
	}
	defer rows.Close()

	var out []AIMessage
	for rows.Next() {
		m, scanErr := scanAIMessage(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list ai messages rows: %w", err)
	}
	return out, nil
}

// AppendMessage 插入一条消息。
func (s *AIConversationStore) AppendMessage(ctx context.Context, m AIMessage) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if m.CreatedAt == "" {
		m.CreatedAt = now
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_ai_message
        (message_id, conversation_id, message_role, message_content, tool_call_id, token_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
		m.MessageID, m.ConversationID, m.MessageRole, m.MessageContent,
		nullIfEmpty(m.ToolCallID), nullInt64(m.TokenCount), m.CreatedAt)
	if err != nil {
		return fmt.Errorf("store: append ai message: %w", err)
	}
	return nil
}

// DeleteMessagesFrom 删除指定消息及其之后（含自身）的全部消息，并级联清理同时间点之后的工具调用流水。
func (s *AIConversationStore) DeleteMessagesFrom(ctx context.Context, conversationID, messageID string) error {
	var createdAt string
	err := s.db.QueryRowContext(ctx,
		`SELECT created_at FROM nm_ai_message WHERE conversation_id = ? AND message_id = ?`,
		conversationID, messageID).Scan(&createdAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("store: ai message not found")
		}
		return fmt.Errorf("store: lookup ai message: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		`DELETE FROM nm_ai_message WHERE conversation_id = ? AND created_at >= ?`,
		conversationID, createdAt)
	if err != nil {
		return fmt.Errorf("store: delete ai messages from: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		`DELETE FROM nm_ai_tool_invocation WHERE conversation_id = ? AND created_at >= ?`,
		conversationID, createdAt)
	if err != nil {
		return fmt.Errorf("store: delete ai tool invocations from: %w", err)
	}
	return nil
}

// ListToolInvocations 按创建时间升序返回会话内工具调用流水。
func (s *AIConversationStore) ListToolInvocations(ctx context.Context, conversationID string) ([]AIToolInvocation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT
  invocation_id, conversation_id, run_id, COALESCE(message_id, ''), COALESCE(server_id, ''), tool_name,
  arguments_json, risk_level, invoke_status, COALESCE(result_summary, ''), COALESCE(error_message, ''),
  created_at, updated_at
FROM nm_ai_tool_invocation
WHERE conversation_id = ?
ORDER BY created_at ASC`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("store: list ai tool invocations: %w", err)
	}
	defer rows.Close()

	var out []AIToolInvocation
	for rows.Next() {
		var inv AIToolInvocation
		if scanErr := rows.Scan(
			&inv.InvocationID, &inv.ConversationID, &inv.RunID, &inv.MessageID, &inv.ServerID, &inv.ToolName,
			&inv.ArgumentsJSON, &inv.RiskLevel, &inv.InvokeStatus, &inv.ResultSummary, &inv.ErrorMessage,
			&inv.CreatedAt, &inv.UpdatedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("store: scan ai tool invocation: %w", scanErr)
		}
		if inv.RiskLevel == "" {
			inv.RiskLevel = "read"
		}
		out = append(out, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list ai tool invocations rows: %w", err)
	}
	return out, nil
}

func scanAIConversation(sc rowScanner) (AIConversation, error) {
	var (
		c     AIConversation
		ws    sql.NullString
		title sql.NullString
		prov  sql.NullString
		model sql.NullString
	)
	if err := sc.Scan(&c.ConversationID, &ws, &title, &prov, &model, &c.RowVersion, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return AIConversation{}, fmt.Errorf("store: scan ai conversation: %w", err)
	}
	c.WorkspaceID = ws.String
	c.ConversationTitle = title.String
	c.ProviderID = prov.String
	c.ModelCode = model.String
	return c, nil
}

func scanAIMessage(sc rowScanner) (AIMessage, error) {
	var (
		m      AIMessage
		content sql.NullString
		toolID  sql.NullString
	)
	if err := sc.Scan(
		&m.MessageID, &m.ConversationID, &m.MessageRole, &content, &toolID, &m.TokenCount, &m.CreatedAt,
	); err != nil {
		return AIMessage{}, fmt.Errorf("store: scan ai message: %w", err)
	}
	m.MessageContent = content.String
	m.ToolCallID = toolID.String
	return m, nil
}

// AIToolInvocation 对应 nm_ai_tool_invocation 一行。
type AIToolInvocation struct {
	InvocationID   string
	ConversationID string
	RunID          string
	MessageID      string
	ServerID       string
	ToolName       string
	ArgumentsJSON  string
	RiskLevel      string
	InvokeStatus   string
	ResultSummary  string
	ErrorMessage   string
	CreatedAt      string
	UpdatedAt      string
}

// UpsertToolInvocation 写入一次工具调用流水。
func (s *AIConversationStore) UpsertToolInvocation(ctx context.Context, inv AIToolInvocation) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if inv.CreatedAt == "" {
		inv.CreatedAt = now
	}
	if inv.UpdatedAt == "" {
		inv.UpdatedAt = now
	}
	if inv.ArgumentsJSON == "" {
		inv.ArgumentsJSON = "{}"
	}
	if inv.RiskLevel == "" {
		inv.RiskLevel = "read"
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_ai_tool_invocation (
  invocation_id, conversation_id, run_id, message_id, server_id, tool_name,
  arguments_json, risk_level, invoke_status, result_summary, error_message, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(invocation_id) DO UPDATE SET
  invoke_status = excluded.invoke_status,
  result_summary = excluded.result_summary,
  error_message = excluded.error_message,
  updated_at = excluded.updated_at`,
		inv.InvocationID, inv.ConversationID, inv.RunID, nullIfEmpty(inv.MessageID), nullIfEmpty(inv.ServerID),
		inv.ToolName, inv.ArgumentsJSON, inv.RiskLevel, inv.InvokeStatus,
		nullIfEmpty(inv.ResultSummary), nullIfEmpty(inv.ErrorMessage), inv.CreatedAt, inv.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("store: upsert tool invocation: %w", err)
	}
	return nil
}

// UpdateToolInvocation 更新调用状态与结果摘要。
func (s *AIConversationStore) UpdateToolInvocation(ctx context.Context, invocationID, status, resultSummary, errorMessage string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `UPDATE nm_ai_tool_invocation SET
  invoke_status = ?, result_summary = ?, error_message = ?, updated_at = ?
WHERE invocation_id = ?`,
		status, nullIfEmpty(resultSummary), nullIfEmpty(errorMessage), now, invocationID)
	if err != nil {
		return fmt.Errorf("store: update tool invocation: %w", err)
	}
	return nil
}
