# 打包脚本

| 脚本 | 说明 |
|------|------|
| [bundle-windows.ps1](./bundle-windows.ps1) | 组装 Windows x64 发布目录 |

## 用法

```powershell
# 仓库根目录
pnpm pack:win

# 或直接（平台实现）
.\scripts\platforms\windows\pack\bundle-windows.ps1 -Configuration Release
```

## 输出

默认写入 **`pack/win-x64/`**（仓库根下打包产物目录，见 [pack/README.md](../../pack/README.md)）。

发布包内目录布局见 [docs/pack-output-layout.md](../../docs/pack-output-layout.md)。

## 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `-Configuration` | `Release` | Shell 构建配置 |
| `-OutputDir` | `pack/win-x64` | 发布根目录 |
| `-SkipWebBuild` | `$false` | 跳过 web build |
| `-SkipShellBuild` | `$false` | 跳过 shell build |
