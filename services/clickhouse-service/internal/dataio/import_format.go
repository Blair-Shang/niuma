package dataio

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"niuma/services/clickhouse-service/internal/session"
)

// ImportFormat 导入数据格式。
type ImportFormat string

const (
	// FormatCSV 逗号分隔文本。
	FormatCSV ImportFormat = "csv"
	// FormatTSV 制表符分隔文本。
	FormatTSV ImportFormat = "tsv"
	// FormatJSONEachRow 每行一个 JSON 对象。
	FormatJSONEachRow ImportFormat = "json_each_row"
	// FormatParquet Apache Parquet 文件。
	FormatParquet ImportFormat = "parquet"
)

func resolveImportFormat(opts CsvOptions) ImportFormat {
	switch strings.ToLower(strings.TrimSpace(opts.Format)) {
	case "", "csv":
		return FormatCSV
	case "tsv", "tab", "tabseparated":
		return FormatTSV
	case "json", "json_each_row", "jsoneachrow", "jsonlines", "ndjson":
		return FormatJSONEachRow
	case "parquet":
		return FormatParquet
	default:
		return FormatCSV
	}
}

func clickHouseFormatName(opts CsvOptions) string {
	format := resolveImportFormat(opts)
	switch format {
	case FormatTSV:
		if opts.Header {
			return "TSVWithNames"
		}
		return "TabSeparated"
	case FormatJSONEachRow:
		return "JSONEachRow"
	case FormatParquet:
		return "Parquet"
	default:
		if opts.Header {
			return "CSVWithNames"
		}
		return "CSV"
	}
}

// needsBatchColumnMap 自定义列映射（改名或跳过）时走 PrepareBatch。
func needsBatchColumnMap(opts CsvOptions) bool {
	return len(opts.ColumnMap) > 0
}

func supportsBatchImport(opts CsvOptions) bool {
	switch resolveImportFormat(opts) {
	case FormatCSV, FormatTSV, FormatJSONEachRow:
		return true
	default:
		return false
	}
}

func canUseFormatHTTP(connect session.ConnectParams, opts CsvOptions) bool {
	if needsBatchColumnMap(opts) {
		return false
	}
	if connect.Options.Tunnel != nil && connect.Options.Tunnel.Enabled() {
		return false
	}
	switch resolveImportFormat(opts) {
	case FormatCSV, FormatTSV, FormatJSONEachRow, FormatParquet:
		return true
	default:
		return false
	}
}

func httpInsertEndpoint(connect session.ConnectParams) (baseURL string, insecureSkip bool, err error) {
	host := strings.TrimSpace(connect.HostAddress)
	if host == "" {
		return "", false, fmt.Errorf("clickhouse: host address required")
	}
	if h, _, splitErr := net.SplitHostPort(host); splitErr == nil {
		host = h
	}

	port := connect.PortNumber
	secure := connectOptionsSecure(connect.Options)
	protocol := connect.Options.ProtocolOrDefault()

	if protocol == session.ProtocolHTTP {
		if port <= 0 {
			if secure {
				port = session.DefaultHTTPTLSPort
			} else {
				port = session.DefaultHTTPPort
			}
		}
	} else {
		// Native 会话映射到常见 HTTP 端口
		switch port {
		case 0, session.DefaultNativePort:
			port = session.DefaultHTTPPort
			secure = false
		case session.DefaultNativeTLSPort:
			port = session.DefaultHTTPTLSPort
			secure = true
		default:
			if secure {
				port = session.DefaultHTTPTLSPort
			} else {
				port = session.DefaultHTTPPort
			}
		}
	}

	scheme := "http"
	if secure {
		scheme = "https"
	}
	mode := strings.ToLower(strings.TrimSpace(connect.Options.SSLMode))
	insecureSkip = mode == "disable" || mode == "none" || mode == "allow"
	return fmt.Sprintf("%s://%s:%d/", scheme, host, port), insecureSkip, nil
}

func connectOptionsSecure(o session.ConnectOptions) bool {
	if o.Secure != nil {
		return *o.Secure
	}
	if o.TLS != nil {
		return *o.TLS
	}
	switch strings.ToLower(strings.TrimSpace(o.SSLMode)) {
	case "require", "required", "verify-ca", "verify_ca", "verify-full", "verify_identity", "verify-identity", "true":
		return true
	default:
		return false
	}
}

func buildFormatSettings(opts CsvOptions) string {
	var parts []string
	parts = append(parts, "input_format_skip_unknown_fields=1")
	if opts.MaxErrors > 0 {
		parts = append(parts, "input_format_allow_errors_num="+strconv.FormatUint(opts.MaxErrors, 10))
	}
	if opts.SkipRows > 0 {
		switch resolveImportFormat(opts) {
		case FormatCSV:
			parts = append(parts, "input_format_csv_skip_first_lines="+strconv.Itoa(opts.SkipRows))
		case FormatTSV:
			parts = append(parts, "input_format_tsv_skip_first_lines="+strconv.Itoa(opts.SkipRows))
		case FormatJSONEachRow:
			parts = append(parts, "input_format_json_skip_first_lines="+strconv.Itoa(opts.SkipRows))
		}
	}
	format := resolveImportFormat(opts)
	if format == FormatCSV {
		delim := opts.Delimiter
		if delim == "" {
			delim = ","
		}
		if delim != "," {
			escaped := strings.ReplaceAll(delim, `'`, `\'`)
			parts = append(parts, "format_csv_delimiter='"+escaped+"'")
		}
		if opts.NullString != "" {
			escaped := strings.ReplaceAll(opts.NullString, `'`, `\'`)
			parts = append(parts, "format_csv_null_representation='"+escaped+"'")
		}
	}
	if format == FormatTSV {
		nullTok := tsvNullToken(opts)
		escaped := strings.ReplaceAll(nullTok, `'`, `\'`)
		parts = append(parts, "format_tsv_null_representation='"+escaped+"'")
	}
	return strings.Join(parts, ", ")
}

// importWithFormatHTTP 通过 HTTP 接口流式 INSERT … FORMAT。
func importWithFormatHTTP(
	ctx context.Context,
	connect session.ConnectParams,
	taskID string,
	m *Manager,
	database, table, inputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)
	base, insecureSkip, err := httpInsertEndpoint(connect)
	if err != nil {
		return err
	}

	body, size, cleanup, err := openEncodedImportReader(inputPath, opts.Encoding)
	if err != nil {
		return err
	}
	defer cleanup()

	// 去掉 UTF-8 BOM，避免 FORMAT 把 BOM 吃进首列名/首字段
	stripped, err := skipUTF8BOM(body)
	if err != nil {
		return fmt.Errorf("clickhouse: skip bom: %w", err)
	}
	if size > 0 {
		size = -1 // BOM 剥离后长度不确定
	}

	cr := &countingReader{r: stripped, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("uploaded %d bytes", n))
	}}

	qn := quoteIdent(database) + "." + quoteIdent(table)
	formatName := clickHouseFormatName(opts)
	settings := buildFormatSettings(opts)
	var query string
	if settings != "" {
		query = fmt.Sprintf("INSERT INTO %s SETTINGS %s FORMAT %s", qn, settings, formatName)
	} else {
		query = fmt.Sprintf("INSERT INTO %s FORMAT %s", qn, formatName)
	}

	u, err := url.Parse(base)
	if err != nil {
		return fmt.Errorf("clickhouse: parse http url: %w", err)
	}
	q := u.Query()
	q.Set("query", query)
	if db := strings.TrimSpace(database); db != "" {
		q.Set("database", db)
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), cr)
	if err != nil {
		return fmt.Errorf("clickhouse: build http request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	if size > 0 {
		req.ContentLength = size
	}
	user := strings.TrimSpace(connect.LoginAccount)
	if user == "" {
		user = "default"
	}
	req.SetBasicAuth(user, connect.Secret)

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureSkip}, //nolint:gosec // 与连接配置 ssl_mode=disable 对齐
	}
	client := &http.Client{Transport: transport, Timeout: 0}

	m.emitProgress(taskID, PhaseRunning, 0, 0, "format="+formatName)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("clickhouse: format import http: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = resp.Status
		}
		return fmt.Errorf("clickhouse: format import failed: %s", msg)
	}
	m.emitProgress(taskID, PhaseRunning, cr.n, 0, fmt.Sprintf("imported via %s (%d bytes)", formatName, cr.n))
	return nil
}

func openEncodedImportReader(path, encoding string) (io.ReadCloser, int64, func(), error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("clickhouse: open import file: %w", err)
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, 0, nil, fmt.Errorf("clickhouse: stat import file: %w", err)
	}
	enc := strings.ToLower(strings.TrimSpace(encoding))
	if enc == "" || enc == "utf-8" || enc == "utf8" {
		return f, info.Size(), func() { _ = f.Close() }, nil
	}
	converted, err := decodeToUTF8Reader(f, enc)
	if err != nil {
		_ = f.Close()
		return nil, 0, nil, err
	}
	cleanup := func() {
		_ = converted.Close()
		_ = f.Close()
	}
	// 转码后长度未知
	return converted, -1, cleanup, nil
}
