// Package http11 实现明文 HTTP/1.1 报文规则（RFC 9110 / RFC 9112）。
//
// 请求补齐 Host、Connection、User-Agent、Accept-Encoding、Content-Length，并去掉字段里的 CR/LF。
// 响应按 Content-Length 或 chunked 取完整正文，再解开 gzip / deflate。
package http11

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"fmt"
	"io"
	"strconv"
	"strings"
)

const (
	// UserAgent 是未由调用方指定时写入的产品标识。
	UserAgent = "NiuMa"
	// AcceptEncoding 是本包能够解开的内容编码。
	AcceptEncoding = "gzip, deflate"
	maxMessage     = 1 << 20
)

// BuildRequest 把已解析的请求编成 HTTP/1.1 字节。
// headers 的键不区分大小写；Host 与 Connection 由本函数按连接重写。
func BuildRequest(method, path, host string, port int, headers map[string]string, body []byte) []byte {
	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = "GET"
	}
	if path == "" {
		path = "/"
	}
	fields := map[string]string{}
	for key, value := range headers {
		name, clean, ok := sanitizeField(key, value)
		if !ok {
			continue
		}
		fields[strings.ToLower(name)] = clean
	}
	fields["host"] = formatHost(host, port)
	fields["connection"] = "close"
	if _, ok := fields["user-agent"]; !ok {
		fields["user-agent"] = UserAgent
	}
	if _, ok := fields["accept-encoding"]; !ok {
		fields["accept-encoding"] = AcceptEncoding
	}
	if _, ok := fields["content-length"]; !ok && needsContentLength(method, body) {
		fields["content-length"] = strconv.Itoa(len(body))
	}

	var buf bytes.Buffer
	fmt.Fprintf(&buf, "%s %s HTTP/1.1\r\n", method, path)
	for key, value := range fields {
		fmt.Fprintf(&buf, "%s: %s\r\n", titleHeader(key), value)
	}
	buf.WriteString("\r\n")
	buf.Write(body)
	return buf.Bytes()
}

// Response 是一条已取完整并解开内容编码的 HTTP 响应。
type Response struct {
	Status     int
	StatusText string
	Headers    []Header
	Body       []byte
	Complete   bool
}

// Header 是一条响应头。
type Header struct {
	Name  string
	Value string
}

// ParseResponse 解析缓冲区里的下一条响应。
// done 为 false 表示字节还不够。rest 是这条报文之后的剩余字节。
// method 为 HEAD 时，响应在首部结束，不读取 Content-Length 声明的正文。
func ParseResponse(raw []byte, method string) (msg *Response, rest []byte, done bool, err error) {
	if len(raw) > maxMessage {
		return nil, nil, false, fmt.Errorf("http11: message exceeds %d bytes", maxMessage)
	}
	sep := bytes.Index(raw, []byte("\r\n\r\n"))
	sepLen := 4
	if sep < 0 {
		sep = bytes.Index(raw, []byte("\n\n"))
		sepLen = 2
	}
	if sep < 0 {
		return nil, raw, false, nil
	}
	head := raw[:sep]
	bodyStart := sep + sepLen
	lines := bytes.Split(head, []byte("\n"))
	start := strings.TrimRight(string(lines[0]), "\r")
	status, statusText, ok := parseStatus(start)
	if !ok {
		return nil, nil, false, fmt.Errorf("http11: bad status line")
	}
	var headers []Header
	var contentLength *int
	chunked := false
	encoding := ""
	for _, line := range lines[1:] {
		text := strings.TrimRight(string(line), "\r")
		if text == "" {
			continue
		}
		name, value, ok := splitHeader(text)
		if !ok {
			continue
		}
		headers = append(headers, Header{Name: name, Value: value})
		switch strings.ToLower(name) {
		case "content-length":
			n, convErr := strconv.Atoi(strings.TrimSpace(value))
			if convErr == nil && n >= 0 {
				contentLength = &n
			}
		case "transfer-encoding":
			if strings.Contains(strings.ToLower(value), "chunked") {
				chunked = true
			}
		case "content-encoding":
			encoding = strings.ToLower(strings.TrimSpace(value))
		}
	}
	payload := raw[bodyStart:]
	if noMessageBody(status, method) {
		return &Response{
			Status:     status,
			StatusText: statusText,
			Headers:    headers,
			Complete:   true,
		}, payload, true, nil
	}
	var decoded []byte
	var consumed int
	switch {
	case chunked:
		decoded, consumed, done, err = decodeChunked(payload)
		if err != nil || !done {
			return nil, raw, false, err
		}
	case contentLength != nil:
		if len(payload) < *contentLength {
			return nil, raw, false, nil
		}
		decoded = append([]byte(nil), payload[:*contentLength]...)
		consumed = *contentLength
		done = true
	default:
		return nil, raw, false, nil
	}
	plain, err := decodeContent(decoded, encoding)
	if err != nil {
		return nil, nil, false, err
	}
	headers = rewriteDecodedHeaders(headers, len(plain))
	return &Response{
		Status:     status,
		StatusText: statusText,
		Headers:    headers,
		Body:       plain,
		Complete:   true,
	}, payload[consumed:], true, nil
}

// Bytes 把已解码响应重新写成带 Content-Length 的 HTTP/1.1 报文。
func (r *Response) Bytes() []byte {
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "HTTP/1.1 %d %s\r\n", r.Status, r.StatusText)
	for _, header := range r.Headers {
		fmt.Fprintf(&buf, "%s: %s\r\n", header.Name, header.Value)
	}
	buf.WriteString("\r\n")
	buf.Write(r.Body)
	return buf.Bytes()
}

func noMessageBody(status int, method string) bool {
	if strings.EqualFold(method, "HEAD") {
		return true
	}
	return status < 200 || status == 204 || status == 304
}

func needsContentLength(method string, body []byte) bool {
	if len(body) > 0 {
		return true
	}
	switch method {
	case "POST", "PUT", "PATCH":
		return true
	default:
		return false
	}
}

func formatHost(host string, port int) string {
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		host = "[" + host + "]"
	}
	if port == 80 {
		return host
	}
	return host + ":" + strconv.Itoa(port)
}

func sanitizeField(key, value string) (string, string, bool) {
	name := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(key, "\r", ""), "\n", ""))
	if !validToken(name) {
		return "", "", false
	}
	clean := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r", " "), "\n", " "))
	return name, clean, true
}

func validToken(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case strings.ContainsRune("!#$%&'*+.^_`|~-", r):
		default:
			return false
		}
	}
	return true
}

func titleHeader(key string) string {
	parts := strings.Split(key, "-")
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, "-")
}

func parseStatus(line string) (int, string, bool) {
	const prefix = "HTTP/"
	if !strings.HasPrefix(line, prefix) {
		return 0, "", false
	}
	parts := strings.SplitN(line, " ", 3)
	if len(parts) < 2 {
		return 0, "", false
	}
	code, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, "", false
	}
	text := ""
	if len(parts) == 3 {
		text = parts[2]
	}
	return code, text, true
}

func splitHeader(line string) (string, string, bool) {
	colon := strings.IndexByte(line, ':')
	if colon <= 0 {
		return "", "", false
	}
	return sanitizeField(line[:colon], line[colon+1:])
}

func decodeChunked(raw []byte) (data []byte, consumed int, done bool, err error) {
	i := 0
	for {
		lineEnd := bytes.IndexByte(raw[i:], '\n')
		if lineEnd < 0 {
			return nil, 0, false, nil
		}
		line := strings.TrimRight(string(raw[i:i+lineEnd]), "\r")
		sizeText := line
		if semi := strings.IndexByte(line, ';'); semi >= 0 {
			sizeText = line[:semi]
		}
		size, convErr := strconv.ParseInt(strings.TrimSpace(sizeText), 16, 64)
		if convErr != nil || size < 0 {
			return nil, 0, false, fmt.Errorf("http11: bad chunk size")
		}
		i += lineEnd + 1
		if size == 0 {
			if bytes.HasPrefix(raw[i:], []byte("\r\n")) {
				return data, i + 2, true, nil
			}
			if bytes.HasPrefix(raw[i:], []byte("\n")) {
				return data, i + 1, true, nil
			}
			rest := raw[i:]
			end := bytes.Index(rest, []byte("\r\n\r\n"))
			endLen := 4
			if end < 0 {
				end = bytes.Index(rest, []byte("\n\n"))
				endLen = 2
			}
			if end < 0 {
				return nil, 0, false, nil
			}
			return data, i + end + endLen, true, nil
		}
		if i+int(size) > len(raw) {
			return nil, 0, false, nil
		}
		data = append(data, raw[i:i+int(size)]...)
		i += int(size)
		if bytes.HasPrefix(raw[i:], []byte("\r\n")) {
			i += 2
		} else if bytes.HasPrefix(raw[i:], []byte("\n")) {
			i++
		} else {
			return nil, 0, false, nil
		}
	}
}

// DecodeBody 解开响应的 Content-Encoding。空和 identity 原样返回。
func DecodeBody(body []byte, encoding string) ([]byte, error) {
	return decodeContent(body, encoding)
}

func decodeContent(body []byte, encoding string) ([]byte, error) {
	switch encoding {
	case "", "identity":
		return body, nil
	case "gzip":
		reader, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("http11: gzip: %w", err)
		}
		defer reader.Close()
		return readLimited(reader)
	case "deflate":
		return decodeDeflate(body)
	default:
		return body, nil
	}
}

func decodeDeflate(body []byte) ([]byte, error) {
	zlibReader, err := zlib.NewReader(bytes.NewReader(body))
	if err == nil {
		defer zlibReader.Close()
		plain, readErr := readLimited(zlibReader)
		if readErr == nil {
			return plain, nil
		}
	}
	raw := flate.NewReader(bytes.NewReader(body))
	defer raw.Close()
	return readLimited(raw)
}

func readLimited(r io.Reader) ([]byte, error) {
	plain, err := io.ReadAll(io.LimitReader(r, maxMessage+1))
	if err != nil {
		return nil, err
	}
	if len(plain) > maxMessage {
		return nil, fmt.Errorf("http11: decoded body exceeds %d bytes", maxMessage)
	}
	return plain, nil
}

func rewriteDecodedHeaders(headers []Header, bodyLen int) []Header {
	out := make([]Header, 0, len(headers)+1)
	for _, header := range headers {
		switch strings.ToLower(header.Name) {
		case "transfer-encoding", "content-encoding", "content-length":
			continue
		default:
			out = append(out, header)
		}
	}
	out = append(out, Header{Name: "Content-Length", Value: strconv.Itoa(bodyLen)})
	return out
}
