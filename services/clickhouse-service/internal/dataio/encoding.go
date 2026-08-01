package dataio

import (
	"fmt"
	"io"
	"strings"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

func decoderForEncoding(name string) (encoding.Encoding, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "utf-8", "utf8":
		return nil, nil
	case "gbk", "cp936", "windows-936":
		return simplifiedchinese.GBK, nil
	case "gb18030":
		return simplifiedchinese.GB18030, nil
	default:
		return nil, fmt.Errorf("clickhouse: unsupported encoding %q (use utf-8 or gbk)", name)
	}
}

// decodeToUTF8Reader 将非 UTF-8 文本流转为 UTF-8 ReadCloser。
func decodeToUTF8Reader(r io.Reader, encodingName string) (io.ReadCloser, error) {
	enc, err := decoderForEncoding(encodingName)
	if err != nil {
		return nil, err
	}
	if enc == nil {
		return io.NopCloser(r), nil
	}
	tr := transform.NewReader(r, enc.NewDecoder())
	return io.NopCloser(tr), nil
}
