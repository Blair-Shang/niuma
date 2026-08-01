package ai

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// SkillsRootDir 返回本机已安装 Skill 包根目录。
//
// Windows：%LOCALAPPDATA%\NiuMa\skills
// 其他：~/.niuma/skills；无法确定用户目录时回退到可执行文件同级 skills。
func SkillsRootDir() (string, error) {
	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			return filepath.Join(local, "NiuMa", "skills"), nil
		}
		return skillsFallbackDir()
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".niuma", "skills"), nil
	}
	return skillsFallbackDir()
}

func skillsFallbackDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("ai: resolve skills dir: %w", err)
	}
	return filepath.Join(filepath.Dir(exe), "skills"), nil
}

// SkillPackDir 返回指定 skillCode 的安装目录。
func SkillPackDir(skillCode string) (string, error) {
	root, err := SkillsRootDir()
	if err != nil {
		return "", err
	}
	code := sanitizeSkillCode(skillCode)
	if code == "" {
		return "", fmt.Errorf("ai: invalid skill code")
	}
	return filepath.Join(root, code), nil
}
