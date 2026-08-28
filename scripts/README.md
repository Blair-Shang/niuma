# 脚本目录（scripts/）

脚本按 **统一入口 / 通用逻辑 / 平台实现** 分层，支持 Windows、Linux、麒麟、macOS 的本机构建、打包与安装程序生成。

> **构建约束**：`build:*`、`pack:*`、`release:*` 须在目标操作系统本机（或同架构容器）执行；入口脚本会校验 `platform` + `arch` 与宿主机一致，**不支持交叉打包**（例如不得在 Windows 上打 Linux/macOS 包）。

## 目录结构

| 目录 | 用途 |
|------|------|
| [entry/](./entry/) | **统一入口层**：供 `package.json`、开发者日常调用 |
| [shared/](./shared/) | **平台无关逻辑**：服务构建、版本、合规、CEF stage、签名辅助 |
| [platforms/](./platforms/) | **平台实现层**：按 Windows / Linux / 麒麟 / macOS 分发 |
| [pack/](./pack/) | 打包说明与约定 |
| [sql/](./sql/) | SQL 迁移源脚本（SQLite） |

## 产物路径约定

| 类型 | 路径 |
|------|------|
| 服务二进制 | `services/bin/<platform>-<arch>/` |
| 壳层构建 | `build/shell-<platform>-<arch>/` |
| 打包输出 | `output/<platform>-<arch>/<format>/` |
| 版本清单 | `build/version.json`（由 `pnpm version:sync` 生成，单一来源：根 `package.json`） |

发布包内运行时布局见 [../docs/pack-output-layout.md](../docs/pack-output-layout.md)。

## 1. `entry/` 统一入口

| 脚本 | 说明 |
|------|------|
| `dev.ps1` / `dev.sh` | 开发运行 |
| `dev-platform.ps1` / `dev-platform.sh` | platform-core 前台调试 |
| `setup.ps1` / `setup.sh` | 环境准备（工具链、CEF 等） |
| `build.ps1` / `build.sh` | 构建 `shell` 或 `services`（含本机矩阵校验） |
| `pack.ps1` / `pack.sh` | 绿色目录 / `.deb` / `.app` 等组装 |
| `installer.ps1` / `installer.sh` | 安装程序（Setup.exe / Setup.run / Setup.pkg） |
| `cef-download.ps1` / `cef-download.sh` | CEF 运行时下载 |
| `sync-version.ps1` / `sync-version.sh` | 同步版本并生成 `build/version.json` |

Windows 使用 PowerShell（`.ps1`），Unix-like 使用 Bash（`.sh`）。`pack.ps1` 仅分发 Windows；Linux / 麒麟 / macOS 使用 `pack.sh`。

## 2. `shared/` 通用逻辑

| 路径 | 说明 |
|------|------|
| `shared/build/build-services.ps1` | 服务矩阵构建（Windows，本机校验） |
| `shared/build/build-services.sh` | 服务矩阵构建（Unix，本机校验） |
| `shared/version/emit-build-info.mjs` | 版本同步与构建元数据生成 |
| `shared/lib/version.ps1` | Windows 版本 / ldflags / CMake 参数 |
| `shared/lib/matrix.ps1` | Windows 矩阵路径与本机校验 |
| `shared/lib/common.sh` | Unix 矩阵路径、CEF 索引、本机校验 |
| `shared/setup/download-cef-core.sh` | CEF index 下载核心 |
| `shared/package/stage-services.ps1` / `.sh` | 服务产物 stage 到壳层目录 |
| `shared/package/stage-cef-runtime.sh` | Unix 打包时捆绑 CEF 运行时 |
| `shared/package/stage-compliance.ps1` / `.sh` | 商用合规文件（CEF 许可、NOTICES、`version.json`） |
| `shared/package/make-self-extracting-run.sh` | Linux/麒麟自解压 `.run` |
| `shared/sign/sign-windows.ps1` | Authenticode（`CODESIGN_CERT`）；`REQUIRE_CODESIGN` 可强制） |
| `shared/sign/codesign-macos.sh` | 从内到外 codesign + Hardened Runtime（不用 `--deep`） |
| `shared/sign/notarize-macos.sh` | notarytool 公证并 stapler（`.pkg` / `.dmg`） |
| `shared/tasks/stop-services.ps1` | 构建前停止本机服务进程 |

## 3. `platforms/` 平台实现

### Windows（`platforms/windows/`）

| 路径 | 说明 |
|------|------|
| `run/dev.ps1` | 开发运行 |
| `setup/setup-desktop.ps1` | 桌面依赖（CMake、MSVC 等） |
| `setup/download-cef.ps1` | CEF 下载（x64 自动 `windows64`，ARM64 自动 `windowsarm64`） |
| `build/build-shell.ps1` | CEF 壳层构建 |
| `pack/bundle-windows.ps1` | 绿色目录组装 |
| `pack/build-installer.ps1` | Inno Setup 6 → `Setup.exe` |

### Linux（`platforms/linux/`）

| 路径 | 说明 |
|------|------|
| `build/build-shell.sh` | CEF 壳层构建 |
| `setup/download-cef.sh` | CEF 下载 |
| `pack/pack-linux.sh` | `.deb` 组装 |
| `pack/pack-rpm.sh` | `.rpm`（需 `fpm` 或 `rpmbuild`，独立命令） |
| `pack/build-installer.sh` | zenity 向导 `Setup.run` + `Uninstall.run` |

### 麒麟（`platforms/kylin/`）

复用 Linux 构建与打包脚本，通过 `--platform kylin` 与包名 `niuma-kylin` 区分。

### macOS（`platforms/macos/`）

| 路径 | 说明 |
|------|------|
| `build/build-shell.sh` | CEF 壳层 + Framework |
| `setup/download-cef.sh` | CEF 下载 |
| `pack/pack-macos.sh` | `.app` + 可选 `.dmg` |
| `pack/build-installer.sh` | `Setup.pkg`（pkgbuild + productbuild） |

> Unix 侧 `platforms/*/run/dev.sh` 仍为脚手架提示，**不影响打包发布**；日常 Windows 开发用 `pnpm dev:hot`。

## 常用命令

### 日常开发（Windows x64）

```powershell
pnpm dev:hot
pnpm setup:desktop
pnpm cef:download          # 首次或更新 CEF
pnpm build:shell
pnpm build:services
pnpm version:sync          # 单独同步版本（build:web 已自动执行）
```

### 一键发布（须在对应 OS 本机或容器内）

| 平台 | 命令 | 主要产物 |
|------|------|----------|
| Windows x64 | `pnpm release:win` | `output/windows-x64/dir/` + `setup/NiuMa-*-x64-Setup.exe` |
| Windows arm64 | `pnpm release:win:arm64` | 同上（arm64）；CEF 用 `windowsarm64` |
| Linux x64 | `pnpm release:linux` | `.deb` + `Setup.run` + `Uninstall.run` |
| Linux arm64 | `pnpm release:linux:arm64` | 同上 |
| 麒麟 x64 | `pnpm release:kylin` | `niuma-kylin` 包 + 向导安装 |
| 麒麟 arm64 | `pnpm release:kylin:arm64` | 同上 |
| macOS x64 | `pnpm release:macos` | `.app` / `.dmg` + `Setup.pkg` |
| macOS arm64 | `pnpm release:macos:arm64` | 同上 |

`release:*` = `build:*` + `pack:*` + `pack:*:setup`（含 GUI 安装程序）。

### 分步命令命名

- `build:<platform>` / `build:<platform>:arm64` — web + services + shell 全量构建
- `build:shell:<platform>`、`build:services:<platform>` — 仅壳层或仅服务
- `pack:<platform>` — 绿色目录 / deb / app 等
- `pack:<platform>:setup` — 安装程序
- `pack:linux:rpm` — 可选 RPM（未纳入 `release:linux`）

Unix 上 `build:services:linux` 等走 `bash scripts/entry/build.sh`，不再从 Windows PowerShell 交叉编译。

### 首次发版前检查

1. 根 `package.json` 的 `version` 已更新（semver `x.y.z`）；Git tag 必须是 `v` + 同一版本（如 `v1.0.0`）
2. 目标机已 `pnpm setup:desktop` 或 `pnpm setup:unix`
3. 已 `pnpm cef:download`（或平台对应 `cef:download:*`）
4. Linux 打 deb 需 `dpkg-deb`；打 setup 目标机需 `zenity` + `dpkg`
5. Windows 打 setup 需 [Inno Setup 6](https://jrsoftware.org/isinfo.php)
6. 对外分发：Windows 配 `CODESIGN_CERT`；macOS 配 `CODESIGN_IDENTITY` + `NOTARY_*`；正式包可设 `REQUIRE_CODESIGN=1`

`build/version.json` 含市场版本 `version`、渠道 `channel`（默认 `stable`）、Git `buildId`、递增 `buildNumber`（Windows 文件版本第 4 段 / macOS `CFBundleVersion`）。

### 签名与静默安装

```powershell
# Windows：签名 niuma.exe + Setup.exe；正式发版强制签名
$env:CODESIGN_CERT = "<thumbprint 或证书主题名>"
$env:REQUIRE_CODESIGN = "1"
pnpm pack:win
pnpm pack:win:setup
# 企业静默 / 仅当前用户：
#   NiuMa-1.0.0-x64-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-
#   NiuMa-1.0.0-x64-Setup.exe /CURRENTUSER
```

```bash
# macOS：Hardened Runtime + 从内到外 codesign（不用 --deep）；公证并 stapler
export CODESIGN_IDENTITY="Developer ID Application: ..."
export CODESIGN_INSTALLER_IDENTITY="Developer ID Installer: ..."  # pkg，可省略则回退上一行
export NOTARY_APPLE_ID="..."
export NOTARY_APP_PASSWORD="..."
export NOTARY_TEAM_ID="..."
export REQUIRE_CODESIGN=1
pnpm release:macos
```

```bash
# Linux：.deb 为主；可选 GPG。Setup.run 仅为向导外壳。
export GPG_KEY_ID="..."
pnpm pack:linux
sudo dpkg -i output/linux-x64/deb/niuma_*_amd64.deb
sudo apt-get install -f   # 补依赖
```

## 当前能力摘要

- 四平台 × x64/arm64 矩阵脚本与统一产物路径
- 单一版本源：semver + channel + buildNumber；`v*` tag 必须与 `package.json` 一致
- 各平台安装包内含 `licenses/`（CEF 许可、NOTICES）与 `version.json`
- Windows：Inno 管理员/当前用户、静默参数、Authenticode；macOS：Hardened Runtime + 公证；Linux：`.deb` 为主
- 本机构建校验，禁止跨 OS 打包

## GitHub Actions 自动打包

工作流：[.github/workflows/release.yml](../.github/workflows/release.yml)。在对应 OS 的 GitHub 托管 runner 上跑 `release:*`，产物上传 Artifact；打 `v*` tag（或手动勾选 Create Release）时挂到 GitHub Release。

| Runner | 命令 | 产物 |
|--------|------|------|
| `windows-2022` | `pnpm release:win` | `output/windows-x64/`（`Setup.exe`） |
| `ubuntu-22.04` | `pnpm release:linux` | `output/linux-x64/`（`.deb` + `Setup.run`） |
| `macos-14`（arm64） | `pnpm release:macos:arm64` | `output/macos-arm64/`（`.dmg` + `Setup.pkg`） |

Windows arm64 / Linux arm64 / 麒麟没有官方托管 runner，需自建后再扩矩阵。Linux / macOS 桌面运行链路仍未闭环，对应 job 可能失败；`fail-fast: false`，成功的平台仍会出包。

### 触发

```bash
git tag v1.0.0
git push origin v1.0.0
```

或 Actions → **Pack and Release** → Run workflow。未打 `v*` tag 时只留 Artifact，不创建 Release（避免 `pack-*` 垃圾 tag）。`v*` 构建会校验 tag 与 `package.json` 版本一致。

`@niuma/ui` 是同级私有仓（`link:../../niuma-ui`）。工作流会再 checkout `{owner}/niuma-ui`。请在本仓 Settings → Secrets 配置：

| Secret | 用途 |
|--------|------|
| `NIUMA_UI_TOKEN` | 能读 `niuma-ui` 的 PAT（私有仓必填；同账号公开仓可省略） |
| `WINDOWS_PFX_BASE64` / `WINDOWS_PFX_PASSWORD` | 可选，Windows Authenticode |
| `MACOS_P12_BASE64` / `MACOS_P12_PASSWORD` | 可选，导入 Developer ID |
| `CODESIGN_IDENTITY` | 可选，macOS `codesign` / `productsign` 证书名 |
| `CODESIGN_INSTALLER_IDENTITY` | 可选，macOS `productsign`（Installer 证书） |
| `NOTARY_APPLE_ID` / `NOTARY_APP_PASSWORD` / `NOTARY_TEAM_ID` | 可选，公证 |
| `GPG_KEY_ID` | 可选，Linux `.deb` 签名 |

手动跑时可填 `niuma_ui_ref`（默认 `v1.1.8`，须与已发布的 niuma-ui tag 对齐）。

CEF 体积大：工作流在下载后立刻 `cache/save`（不等打包结束），缓存键只跟 `scripts/shared/setup/cef-pin.txt` 走。版本钉在该文件的 `cef_version`（不拉 Spotify 整份 index.json）；换官方构建时改 `cef_version` 并加 `cache_id`。入口脚本对整次下载做 3 次指数退避重试。

### 后续可选增强

- 自建 runner 覆盖 Windows/Linux arm64 与麒麟
- `pack:linux:rpm` 纳入 `release:linux` 或 deb GPG 签
- 前端关于页展示 `shell.version`
- Unix 本地 `dev.sh` 与 Windows 对等的完整开发链路

详见 [../docs/17-script-platform-layout.md](../docs/17-script-platform-layout.md)、[../docs/pack-output-layout.md](../docs/pack-output-layout.md)。
