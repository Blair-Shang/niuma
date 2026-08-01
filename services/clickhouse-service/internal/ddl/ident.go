package ddl

import (
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/session"
)

func quoteIdent(name string) (string, error) {
	return session.QuoteIdent(name)
}

func qualified(database, name string) (string, error) {
	db, err := quoteIdent(database)
	if err != nil {
		return "", err
	}
	tbl, err := quoteIdent(name)
	if err != nil {
		return "", err
	}
	return db + "." + tbl, nil
}

// onClusterClause 返回 " ON CLUSTER `name`"；cluster 为空则返回空串。
func onClusterClause(cluster string) (string, error) {
	c := strings.TrimSpace(cluster)
	if c == "" {
		return "", nil
	}
	if strings.ContainsAny(c, ";\x00") {
		return "", fmt.Errorf("clickhouse: invalid cluster name")
	}
	qn, err := quoteIdent(c)
	if err != nil {
		return "", err
	}
	return " ON CLUSTER " + qn, nil
}

func requireDatabaseName(database, name string) error {
	if strings.TrimSpace(database) == "" {
		return fmt.Errorf("clickhouse: database required")
	}
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("clickhouse: table name required")
	}
	return nil
}

func validateDataType(dt string) error {
	dt = strings.TrimSpace(dt)
	if dt == "" {
		return fmt.Errorf("dataType required")
	}
	if strings.ContainsAny(dt, ";\x00") {
		return fmt.Errorf("invalid dataType")
	}
	return nil
}

func escapeStringLiteral(s string) string {
	return strings.ReplaceAll(s, `'`, `''`)
}
