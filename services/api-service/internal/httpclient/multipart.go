package httpclient

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
)

// FormPart 是 multipart 的一个字段。FilePath 非空时按文件上传。
type FormPart struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	FilePath string `json:"filePath"`
}

// BuildMultipart 把文本字段和本地文件打成 multipart/form-data。
func BuildMultipart(parts []FormPart) ([]byte, string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for _, part := range parts {
		name := strings.TrimSpace(part.Name)
		if name == "" {
			continue
		}
		if strings.TrimSpace(part.FilePath) != "" {
			if err := writeFilePart(writer, name, part.FilePath); err != nil {
				return nil, "", err
			}
			continue
		}
		field, err := writer.CreateFormField(name)
		if err != nil {
			return nil, "", fmt.Errorf("http: form field: %w", err)
		}
		if _, err := field.Write([]byte(part.Value)); err != nil {
			return nil, "", fmt.Errorf("http: form field: %w", err)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", fmt.Errorf("http: form: %w", err)
	}
	if buf.Len() > maxBody {
		return nil, "", fmt.Errorf("http: request exceeds %d bytes", maxBody)
	}
	return buf.Bytes(), writer.FormDataContentType(), nil
}

func writeFilePart(writer *multipart.Writer, name, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("http: open file: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("http: stat file: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("http: %s is a directory", path)
	}
	if info.Size() > maxBody {
		return fmt.Errorf("http: file exceeds %d bytes", maxBody)
	}
	part, err := writer.CreateFormFile(name, filepath.Base(path))
	if err != nil {
		return fmt.Errorf("http: form file: %w", err)
	}
	written, err := io.Copy(part, io.LimitReader(file, maxBody+1))
	if err != nil {
		return fmt.Errorf("http: read file: %w", err)
	}
	if written > maxBody {
		return fmt.Errorf("http: file exceeds %d bytes", maxBody)
	}
	return nil
}
