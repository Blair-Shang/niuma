package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// AISkill 对应 nm_ai_skill 一行。
type AISkill struct {
	SkillID        string
	SkillCode      string
	SkillName      string
	SkillScope     string
	PromptTemplate string
	ParamSchema    string
	SkillOptions   string
	RecordStatus   string
	SortOrder      int64
	RowVersion     int64
	CreatedAt      string
	UpdatedAt      string
}

// AISkillStore 封装 Skill 表读写。
type AISkillStore struct {
	db *sql.DB
}

// NewAISkillStore 基于已打开的 SQLite 连接池创建 AISkillStore。
func NewAISkillStore(db *sql.DB) *AISkillStore {
	return &AISkillStore{db: db}
}

const aiSkillColumns = `skill_id, skill_code, skill_name, skill_scope, prompt_template,
    param_schema, skill_options, record_status, sort_order, row_version, created_at, updated_at`

func scanAISkill(sc rowScanner) (AISkill, error) {
	var (
		s     AISkill
		scope sql.NullString
	)
	if err := sc.Scan(
		&s.SkillID, &s.SkillCode, &s.SkillName, &scope, &s.PromptTemplate,
		&s.ParamSchema, &s.SkillOptions, &s.RecordStatus, &s.SortOrder, &s.RowVersion,
		&s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return AISkill{}, err
	}
	s.SkillScope = scope.String
	return s, nil
}

// List 返回 Skill 列表；status 为空不过滤。
func (s *AISkillStore) List(ctx context.Context, status string) ([]AISkill, error) {
	query := "SELECT " + aiSkillColumns + " FROM nm_ai_skill"
	var args []any
	if status != "" {
		query += " WHERE record_status = ?"
		args = append(args, status)
	}
	query += " ORDER BY sort_order, skill_name"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: list ai skills: %w", err)
	}
	defer rows.Close()
	var out []AISkill
	for rows.Next() {
		row, scanErr := scanAISkill(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("store: scan ai skill: %w", scanErr)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list ai skills rows: %w", err)
	}
	return out, nil
}

// Get 按 skill_id 读取；不存在返回 nil。
func (s *AISkillStore) Get(ctx context.Context, skillID string) (*AISkill, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+aiSkillColumns+" FROM nm_ai_skill WHERE skill_id = ?", skillID)
	sk, err := scanAISkill(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("store: get ai skill: %w", err)
	}
	return &sk, nil
}

// GetByCode 按 skill_code 读取；不存在返回 nil。
func (s *AISkillStore) GetByCode(ctx context.Context, skillCode string) (*AISkill, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+aiSkillColumns+" FROM nm_ai_skill WHERE skill_code = ?", skillCode)
	sk, err := scanAISkill(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("store: get ai skill by code: %w", err)
	}
	return &sk, nil
}

// Create 插入 Skill。
func (s *AISkillStore) Create(ctx context.Context, sk AISkill) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if sk.CreatedAt == "" {
		sk.CreatedAt = now
	}
	if sk.UpdatedAt == "" {
		sk.UpdatedAt = now
	}
	if sk.ParamSchema == "" {
		sk.ParamSchema = "{}"
	}
	if sk.SkillOptions == "" {
		sk.SkillOptions = "{}"
	}
	if sk.RecordStatus == "" {
		sk.RecordStatus = "active"
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_ai_skill (
  skill_id, skill_code, skill_name, skill_scope, prompt_template,
  param_schema, skill_options, record_status, sort_order, row_version, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		sk.SkillID, sk.SkillCode, sk.SkillName, nullIfEmpty(sk.SkillScope), sk.PromptTemplate,
		sk.ParamSchema, sk.SkillOptions, sk.RecordStatus, sk.SortOrder, sk.CreatedAt, sk.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("store: create ai skill: %w", err)
	}
	return nil
}

// Update 更新 Skill（乐观锁）。
func (s *AISkillStore) Update(ctx context.Context, sk AISkill, rowVersion int64) (int64, bool, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	if sk.ParamSchema == "" {
		sk.ParamSchema = "{}"
	}
	if sk.SkillOptions == "" {
		sk.SkillOptions = "{}"
	}
	res, err := s.db.ExecContext(ctx, `UPDATE nm_ai_skill SET
  skill_code = ?, skill_name = ?, skill_scope = ?, prompt_template = ?,
  param_schema = ?, skill_options = ?, record_status = ?, sort_order = ?,
  row_version = row_version + 1, updated_at = ?
WHERE skill_id = ? AND row_version = ?`,
		sk.SkillCode, sk.SkillName, nullIfEmpty(sk.SkillScope), sk.PromptTemplate,
		sk.ParamSchema, sk.SkillOptions, sk.RecordStatus, sk.SortOrder, now,
		sk.SkillID, rowVersion,
	)
	if err != nil {
		return 0, false, fmt.Errorf("store: update ai skill: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return 0, false, nil
	}
	return rowVersion + 1, true, nil
}

// Delete 删除 Skill。
func (s *AISkillStore) Delete(ctx context.Context, skillID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM nm_ai_skill WHERE skill_id = ?`, skillID)
	if err != nil {
		return fmt.Errorf("store: delete ai skill: %w", err)
	}
	return nil
}
