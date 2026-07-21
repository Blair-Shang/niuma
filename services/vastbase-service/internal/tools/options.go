package tools

import (
	"fmt"
	"strconv"
	"strings"
)

// DumpFormat 是 vb_dump -F 输出格式。
type DumpFormat string

const (
	DumpFormatCustom    DumpFormat = "c"
	DumpFormatDirectory DumpFormat = "d"
	DumpFormatTar       DumpFormat = "t"
	DumpFormatPlain     DumpFormat = "p"
)

// ContentMode 控制结构 / 数据导出范围。
type ContentMode string

const (
	ContentModeAll        ContentMode = "all"
	ContentModeSchemaOnly ContentMode = "schema_only"
	ContentModeDataOnly   ContentMode = "data_only"
)

// DumpOptions 是 vb_dump 专业化参数。
type DumpOptions struct {
	Format         DumpFormat  `json:"format"`
	Mode           ContentMode `json:"mode"`
	Schemas        []string    `json:"schemas"`
	ExcludeSchemas []string    `json:"excludeSchemas"`
	Tables         []string    `json:"tables"`
	ExcludeTables  []string    `json:"excludeTables"`
	Jobs           *int        `json:"jobs"`
	Compress       *int        `json:"compress"`
	Clean          bool        `json:"clean"`
	Create         bool        `json:"create"`
	NoOwner        bool        `json:"noOwner"`
	NoPrivileges   bool        `json:"noPrivileges"`
	Blobs          bool        `json:"blobs"`
	Encoding       string      `json:"encoding"`
	Verbose        bool        `json:"verbose"`
}

// RestoreOptions 是 vb_restore 专业化参数。
type RestoreOptions struct {
	Format            DumpFormat  `json:"format"`
	Mode              ContentMode `json:"mode"`
	Schemas           []string    `json:"schemas"`
	Tables            []string    `json:"tables"`
	Jobs              *int        `json:"jobs"`
	Clean             *bool       `json:"clean"`
	IfExists          *bool       `json:"ifExists"`
	Create            bool        `json:"create"`
	NoOwner           bool        `json:"noOwner"`
	NoPrivileges      bool        `json:"noPrivileges"`
	DisableTriggers   bool        `json:"disableTriggers"`
	SingleTransaction bool        `json:"singleTransaction"`
	Verbose           bool        `json:"verbose"`
}

// NormalizeDumpOptions 填充默认值并校验互斥项。
func NormalizeDumpOptions(opts DumpOptions) (DumpOptions, error) {
	if opts.Format == "" {
		opts.Format = DumpFormatCustom
	}
	switch opts.Format {
	case DumpFormatCustom, DumpFormatDirectory, DumpFormatTar, DumpFormatPlain:
	default:
		return opts, fmt.Errorf("vastbase: unsupported dump format %q", opts.Format)
	}
	if opts.Mode == "" {
		opts.Mode = ContentModeAll
	}
	switch opts.Mode {
	case ContentModeAll, ContentModeSchemaOnly, ContentModeDataOnly:
	default:
		return opts, fmt.Errorf("vastbase: unsupported dump mode %q", opts.Mode)
	}
	if opts.Jobs != nil {
		if *opts.Jobs < 1 {
			return opts, fmt.Errorf("vastbase: dump jobs must be >= 1")
		}
		if opts.Format != DumpFormatCustom && opts.Format != DumpFormatDirectory {
			return opts, fmt.Errorf("vastbase: dump jobs only supported for format c or d")
		}
	}
	if opts.Compress != nil {
		if *opts.Compress < 0 || *opts.Compress > 9 {
			return opts, fmt.Errorf("vastbase: dump compress must be 0-9")
		}
	}
	return opts, nil
}

// NormalizeRestoreOptions 填充默认值并校验。
func NormalizeRestoreOptions(opts RestoreOptions) (RestoreOptions, error) {
	if opts.Format != "" {
		switch opts.Format {
		case DumpFormatCustom, DumpFormatDirectory, DumpFormatTar, DumpFormatPlain:
		default:
			return opts, fmt.Errorf("vastbase: unsupported restore format %q", opts.Format)
		}
	}
	if opts.Mode == "" {
		opts.Mode = ContentModeAll
	}
	switch opts.Mode {
	case ContentModeAll, ContentModeSchemaOnly, ContentModeDataOnly:
	default:
		return opts, fmt.Errorf("vastbase: unsupported restore mode %q", opts.Mode)
	}
	if opts.Clean == nil {
		v := true
		opts.Clean = &v
	}
	if opts.IfExists == nil {
		v := true
		opts.IfExists = &v
	}
	if opts.Jobs != nil && *opts.Jobs < 1 {
		return opts, fmt.Errorf("vastbase: restore jobs must be >= 1")
	}
	return opts, nil
}

// DumpArgs 根据连接与选项构造 vb_dump 参数。
func DumpArgs(host, port, user, database, outputPath string, opts DumpOptions) ([]string, error) {
	opts, err := NormalizeDumpOptions(opts)
	if err != nil {
		return nil, err
	}
	args := []string{
		"-h", host,
		"-p", port,
		"-U", user,
		"-d", database,
		"-F", string(opts.Format),
		"-f", outputPath,
		"--no-password",
	}
	args = appendContentMode(args, opts.Mode)
	args = appendRepeat(args, "-n", opts.Schemas)
	args = appendRepeat(args, "-N", opts.ExcludeSchemas)
	args = appendRepeat(args, "-t", opts.Tables)
	args = appendRepeat(args, "-T", opts.ExcludeTables)
	if opts.Jobs != nil {
		args = append(args, "-j", strconv.Itoa(*opts.Jobs))
	}
	if opts.Compress != nil {
		args = append(args, "-Z", strconv.Itoa(*opts.Compress))
	}
	if opts.Clean {
		args = append(args, "-c")
	}
	if opts.Create {
		args = append(args, "-C")
	}
	if opts.NoOwner {
		args = append(args, "-O")
	}
	if opts.NoPrivileges {
		args = append(args, "-x")
	}
	if opts.Blobs {
		args = append(args, "-b")
	}
	if enc := strings.TrimSpace(opts.Encoding); enc != "" {
		args = append(args, "-E", enc)
	}
	if opts.Verbose {
		args = append(args, "-v")
	}
	return args, nil
}

// RestoreArgs 根据连接与选项构造 vb_restore 参数。
func RestoreArgs(host, port, user, database, inputPath string, opts RestoreOptions) ([]string, error) {
	opts, err := NormalizeRestoreOptions(opts)
	if err != nil {
		return nil, err
	}
	args := []string{
		"-h", host,
		"-p", port,
		"-U", user,
		"-d", database,
		"--no-password",
	}
	if opts.Format != "" {
		args = append(args, "-F", string(opts.Format))
	}
	args = appendContentMode(args, opts.Mode)
	args = appendRepeat(args, "-n", opts.Schemas)
	args = appendRepeat(args, "-t", opts.Tables)
	if opts.Jobs != nil {
		args = append(args, "-j", strconv.Itoa(*opts.Jobs))
	}
	if opts.Clean != nil && *opts.Clean {
		args = append(args, "--clean")
	}
	if opts.IfExists != nil && *opts.IfExists {
		args = append(args, "--if-exists")
	}
	if opts.Create {
		args = append(args, "-C")
	}
	if opts.NoOwner {
		args = append(args, "-O")
	}
	if opts.NoPrivileges {
		args = append(args, "-x")
	}
	if opts.DisableTriggers {
		args = append(args, "--disable-triggers")
	}
	if opts.SingleTransaction {
		args = append(args, "--single-transaction")
	}
	if opts.Verbose {
		args = append(args, "-v")
	}
	args = append(args, inputPath)
	return args, nil
}

// VsqlFileArgs 构造 vsql -f 执行 SQL 文件参数。
func VsqlFileArgs(host, port, user, database, inputPath string) []string {
	return []string{
		"-h", host,
		"-p", port,
		"-U", user,
		"-d", database,
		"-v", "ON_ERROR_STOP=1",
		"-f", inputPath,
		"--no-password",
	}
}

// PsqlFileArgs 构造 psql -f（备选）。
func PsqlFileArgs(host, port, user, database, inputPath string) []string {
	return VsqlFileArgs(host, port, user, database, inputPath)
}

func appendContentMode(args []string, mode ContentMode) []string {
	switch mode {
	case ContentModeSchemaOnly:
		return append(args, "-s")
	case ContentModeDataOnly:
		return append(args, "-a")
	default:
		return args
	}
}

func appendRepeat(args []string, flag string, values []string) []string {
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		args = append(args, flag, v)
	}
	return args
}

func dumpTempExt(format DumpFormat) string {
	switch format {
	case DumpFormatPlain:
		return ".sql"
	case DumpFormatTar:
		return ".tar"
	case DumpFormatDirectory:
		return ".dir"
	default:
		return ".dump"
	}
}
