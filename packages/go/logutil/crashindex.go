package logutil

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const crashSignatureFrames = 6

// CrashGroup 是本机崩溃转储按栈签名聚类后的一组。
type CrashGroup struct {
	Signature  string `json:"signature"`
	Service    string `json:"service"`
	Count      int    `json:"count"`
	SamplePath string `json:"samplePath"`
	UpdatedAt  string `json:"updatedAt"`
}

// ListCrashGroups 扫描 <logDir>/crashes 并按栈签名聚类。无法解析的 minidump 按文件名归组。
func ListCrashGroups() []CrashGroup {
	dir := Dir()
	if dir == "" {
		return nil
	}
	crashDir := filepath.Join(dir, "crashes")
	entries, err := os.ReadDir(crashDir)
	if err != nil {
		return nil
	}
	bySig := map[string]*accCrash{}
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		name := ent.Name()
		path := filepath.Join(crashDir, name)
		info, err := ent.Info()
		if err != nil {
			continue
		}
		service := crashServiceFromName(name)
		mtime := info.ModTime().UTC().Format(time.RFC3339)
		if strings.HasSuffix(strings.ToLower(name), ".dmp") {
			sig := "minidump:" + name
			addCrashGroup(bySig, sig, service, path, mtime)
			continue
		}
		raw, err := os.ReadFile(path)
		if err != nil || len(raw) == 0 {
			continue
		}
		sigs := parseGoCrashSignatures(string(raw))
		if len(sigs) == 0 {
			addCrashGroup(bySig, "unparsed:"+name, service, path, mtime)
			continue
		}
		for _, sig := range sigs {
			addCrashGroup(bySig, sig, service, path, mtime)
		}
	}
	out := make([]CrashGroup, 0, len(bySig))
	for _, a := range bySig {
		out = append(out, a.group)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	return out
}

func addCrashGroup(bySig map[string]*accCrash, sig, service, path, mtime string) {
	cur := bySig[sig]
	if cur == nil {
		bySig[sig] = &accCrash{group: CrashGroup{
			Signature:  sig,
			Service:    service,
			Count:      1,
			SamplePath: path,
			UpdatedAt:  mtime,
		}}
		return
	}
	cur.group.Count++
	if mtime > cur.group.UpdatedAt {
		cur.group.UpdatedAt = mtime
		cur.group.SamplePath = path
	}
}

type accCrash struct {
	group CrashGroup
}

func crashServiceFromName(name string) string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	base = strings.TrimSuffix(base, "-crash")
	return base
}

func parseGoCrashSignatures(text string) []string {
	var out []string
	blocks := splitCrashBlocks(text)
	for _, block := range blocks {
		frames := extractGoFrames(block)
		if len(frames) == 0 {
			continue
		}
		if len(frames) > crashSignatureFrames {
			frames = frames[:crashSignatureFrames]
		}
		sum := sha256.Sum256([]byte(strings.Join(frames, "\n")))
		out = append(out, hex.EncodeToString(sum[:])[:12])
	}
	return out
}

func splitCrashBlocks(text string) []string {
	parts := strings.Split(text, "fatal error:")
	if len(parts) == 1 {
		parts = strings.Split(text, "panic:")
	}
	if len(parts) == 1 {
		if strings.Contains(text, "goroutine ") {
			return []string{text}
		}
		return nil
	}
	var blocks []string
	for i, p := range parts {
		if i == 0 {
			continue
		}
		blocks = append(blocks, p)
	}
	return blocks
}

func extractGoFrames(block string) []string {
	sc := bufio.NewScanner(strings.NewReader(block))
	inStack := false
	var frames []string
	for sc.Scan() {
		line := sc.Text()
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "goroutine ") {
			inStack = true
			continue
		}
		if !inStack {
			continue
		}
		if trim == "" {
			if len(frames) > 0 {
				break
			}
			continue
		}
		if strings.HasPrefix(line, "\t") || strings.HasPrefix(line, " ") {
			continue
		}
		if strings.Contains(line, "(") {
			fn := line
			if i := strings.Index(fn, "("); i > 0 {
				fn = fn[:i]
			}
			frames = append(frames, strings.TrimSpace(fn))
		}
	}
	return frames
}
