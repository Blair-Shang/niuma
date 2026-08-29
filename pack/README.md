# 打包输出目录（pack/）

> 矩阵约定：`output/<platform>-<arch>/<format>/`

## 安装程序一览（向导式「下一步」）

| 平台 | 组装 (`pack:*`) | 安装程序 (`pack:*:setup`) | 一键发布 (`release:*`) |
|------|-----------------|---------------------------|-------------------------|
| Windows | 绿色目录 `dir/` | **Setup.exe**（Inno Setup） | ✅ |
| Linux | `.deb` | **Setup.run**（zenity 向导 + dpkg） | ✅ |
| 麒麟 | `.deb` | **Setup.run** | ✅ |
| macOS | `.app` + `.dmg` | **Setup.pkg**（系统安装向导） | ✅ |

各架构均有 `:arm64` 变体（如 `release:linux:arm64`）。

## 命令示例

```powershell
# Windows
pnpm release:win
# -> output/windows-x64/setup/NiuMa-*-windows-x64-Setup.exe

# Linux（在 Linux 构建机上）
pnpm release:linux
# -> output/linux-x64/deb/*.deb
# -> output/linux-x64/setup/NiuMa-*-linux-x64-Setup.run

# 麒麟
pnpm release:kylin

# macOS
export CODESIGN_IDENTITY="Developer ID Application: ..."
pnpm release:macos
# -> output/macos-x64/setup/NiuMa-*-macos-x64-Setup.pkg
```

仅重打安装包（已有 deb / app）：

```bash
pnpm pack:linux:setup
pnpm pack:macos:setup
```

## 构建机依赖

| 平台 | 打安装包额外需要 |
|------|------------------|
| Windows | [Inno Setup 6](https://jrsoftware.org/isinfo.php)（可免费商用） |
| Linux/麒麟 | `dpkg-deb`（打 deb）、目标机需 `zenity` + `dpkg` |
| macOS | `pkgbuild` / `productbuild`（Xcode CLI） |

详见 [docs/pack-output-layout.md](../docs/pack-output-layout.md)。
