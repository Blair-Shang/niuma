# NiuMa — 全能 AI 运维平台

桌面端：**自封装 CEF + C++ 壳层 + Vue 3 Web + 多语言可插拔后端**。

## 快速开始

```powershell
pnpm install
pnpm setup:desktop    # 首次：准备 C++ / CEF 环境（见下文）
pnpm dev              # 构建并启动 niuma.exe（真实 CEF 桌面窗口）
```

| 场景 | 命令 | 说明 |
|------|------|------|
| 桌面应用（推荐） | `pnpm dev` | 构建 Web + Shell，启动 `niuma.exe` |
| Web 热更新 + CEF | `pnpm dev:hot` | CEF 加载 `http://localhost:5173` |
| UI 组件 Playground | `pnpm dev:ui` | `packages/ui`，端口 5180 |
| 仅 Web（非桌面） | `pnpm dev:web` | Vite 开发服，端口 5173 |
| UI 单元测试 | `pnpm test:ui` | Vitest，500+ 用例 |
| 仅构建壳 | `pnpm build:shell` | 不启动，产出 `niuma.exe` |
| Windows 打包（绿色目录） | `pnpm pack:win` | 输出 `output/windows-x64/dir/` |
| Windows 安装程序 | `pnpm pack:win:setup` | 输出 `output/windows-x64/setup/NiuMa-*-Setup.exe` |
| Windows 一键发布 | `pnpm release:win` | 构建 + 绿色目录 + Setup 安装程序 |
| 跨平台矩阵 | 见 [scripts/README.md](./scripts/README.md) | `release:<platform>` 含向导式安装程序 |

> 主应用必须在 CEF 中运行（`cefQuery` 桥接）。`pnpm dev:web` 仅用于调试 Web 层，**不是**桌面应用。

## 环境要求

当前仓库以 **Windows x64** 为桌面开发目标。

### 通用（前端 / 脚本）

| 工具 | 版本 | 用途 | 官网 / 下载 |
|------|------|------|-------------|
| Node.js | ≥ 20 | 前端构建、pnpm 脚本 | [nodejs.org](https://nodejs.org/) |
| pnpm | ≥ 9（推荐 `corepack enable` 锁定 9.15） | Monorepo 包管理 | [pnpm.io](https://pnpm.io/installation) |
| PowerShell | 5.1+ | `scripts/*.ps1` 入口 | 系统自带；跨平台见 [PowerShell](https://github.com/PowerShell/PowerShell) |
| winget | 可选 | `setup:desktop` 自动安装 CMake / MSVC | [winget 文档](https://learn.microsoft.com/windows/package-manager/winget/) |

前端依赖版本在 `pnpm-workspace.yaml` 的 **catalog** 中统一维护（Vue 3.5、Vite 8、Tailwind 4 等），`web` 与 `packages/ui` 通过 `catalog:` 引用，升级时改一处即可。

### 桌面壳（Layer 3，C++ / CEF）

| 工具 | 版本 | 用途 | 官网 / 下载 |
|------|------|------|-------------|
| Visual Studio 2022 | **C++ 桌面开发** 或 **Build Tools + VC 工具链** | 编译 `shell/` | [VS 下载](https://visualstudio.microsoft.com/downloads/) / [Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |
| CMake | ≥ 3.20 | 对接官方 CEF CMake 工程 | [cmake.org/download](https://cmake.org/download/) |
| CEF Standard Binary | 自动下载 | `third_party/cef/`（约 200MB） | [CEF 官网](https://bitbucket.org/chromiumembedded/cef) / [构建索引](https://cef-builds.spotifycdn.com/index.json) |

说明：

- 仅有 VS Community **未勾选 C++ 工作负载** 时无法编译；`setup:desktop` 会尝试通过 winget 安装 **VS 2022 Build Tools**。
- 构建脚本使用 `vswhere` 查找带 `VC.Tools.x86.x64` 的 VS 实例，生成器优先 **Visual Studio 17 2022**。
- CEF 从 [cef-builds.spotifycdn.com](https://cef-builds.spotifycdn.com/index.json) 拉取 stable / windows64 标准包；升级时对照索引中的版本号与 `scripts` 下载逻辑。

### 后端（规划中）

| 组件 | 技术 | 状态 |
|------|------|------|
| Platform Core | Go | 占位，`platform/` |
| FTP Service | Go | 已接入，`services/ftp-service/` |
| SSH Service | Rust | 开发中，`services/ssh-service/` |
| Rust 公共包 | Rust workspace | `packages/rust/` |

后端开发额外依赖：

| 工具 | 版本 | 用途 | 官网 / 下载 |
|------|------|------|-------------|
| Go | 1.25.x | `platform/`、`ftp-service/`、共享 Go 包 | [go.dev/dl](https://go.dev/dl/) |
| Rustup | stable | 安装 / 管理 Rust toolchain | [rustup.rs](https://rustup.rs/) |
| Rust | stable（当前固定 `1.96.x`） | `ssh-service`、`packages/rust/` | [rust-lang.org](https://www.rust-lang.org/tools/install) / [发布说明](https://github.com/rust-lang/rust/releases) |

说明：

- 仓库根存在 `rust-toolchain.toml`，进入仓库后会强制使用 `stable` toolchain。
- Rust 公共能力放在 `packages/rust/`，当前包含 `niuma-logutil` 与 `niuma-serviceipc` 两个 crate。
- `scripts/shared/build/build-services.ps1` 会同时构建 Go 服务与 Rust 的 `niuma-ssh-service`；日常使用仍建议通过 `pnpm build:services` 或 `scripts/entry/build.ps1 -Target services` 进入。
- 升级校对：以本表「版本」列为仓库基线，对照各官网下载页 / Releases 确认是否有安全补丁或破坏性变更，再改版本约束与脚本。

## 环境准备（首次）

### 1. 安装 Node 与 pnpm

```powershell
node -v    # 需 >= 20
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm -v
```

### 2. 安装前端依赖

```powershell
pnpm install
```

### 3. 准备桌面编译环境

```powershell
pnpm setup:desktop
```

该脚本依次执行：

1. **CMake** — 未安装时 `winget install Kitware.CMake`
2. **MSVC** — 未检测到 VC 工具链时安装 VS 2022 Build Tools（C++ 工作负载）
3. **Rust** — 未检测到 `cargo` 时安装 `rustup` 并切到 `stable`
4. **CEF** — 下载并解压到 `third_party/cef/`

也可分步执行：

```powershell
pnpm cef:download          # 仅下载 CEF
pnpm setup:desktop         # 检查工具链 + 下载 CEF
```

重新下载 CEF：删除 `third_party/cef/` 后再次运行 `pnpm cef:download`。

### 4. 验证桌面启动

```powershell
pnpm dev
```

成功时应出现 CEF 窗口，加载 `app://niuma/`，状态栏显示 **CEF Shell**。

`pnpm dev` 在缺少 CEF 时会自动调用 `setup:desktop`；已准备好环境时可用 `pnpm dev -- -SkipSetup` 跳过检查（PowerShell 透传参数）。

### 5. 准备后端工具链（Go / Rust）

```powershell
go version      # 需 1.25.x
rustup --version
rustc --version
cargo --version
```

首次安装 Rust（Windows）：

```powershell
winget install Rustlang.Rustup --accept-package-agreements --accept-source-agreements
rustup toolchain install stable
rustup default stable
```

构建全部后端服务（默认当前 Windows 开发机目标为 `windows/x64`）：

```powershell
pnpm build:services
```

如需显式指定目标矩阵：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/entry/build.ps1 -Target services -Platform windows -Arch x64
bash scripts/entry/build.sh --target services --platform linux --arch x64
```

成功时会产出：

- 矩阵产物目录：`services/bin/<platform>-<arch>/`
- 当前 Windows 主机为了兼容现有开发链路，仍会同步一份到 `services/bin/*.exe`

### 6. 热更新模式（可选）

```powershell
pnpm dev:hot
```

后台启动 Vite（5173），并设置环境变量 `NIUMMA_DEV_URL=http://localhost:5173`，CEF 窗口直接加载开发服（**跳过 web 生产构建**，改 `web/` 保存即热更新）。

## 本地路径约定

| 内容 | 路径 |
|------|------|
| CEF 二进制 | `third_party/cef/` |
| CEF 下载缓存 | `third_party/.cache/` |
| Web 构建产物 | `web/dist/` |
| Shell 构建产物（矩阵） | `build/shell-windows-x64/Release/niuma.exe` |
| Shell 构建产物（兼容） | `build/shell/Release/niuma.exe`（本机 windows/x64 自动同步） |
| 运行时 Web 资源 | `build/shell-windows-x64/Release/resources/web/`（由构建脚本从 `web/dist` 复制） |
| 用户 SQLite 库 | `%LOCALAPPDATA%\NiuMa\data\niuma.db` |
| Go / Rust 服务产物（矩阵） | `services/bin/<platform>-<arch>/` |
| Go / Rust 服务产物（兼容） | `services/bin/*.exe`（本机 windows/x64 自动同步） |
| Rust 公共 workspace | `packages/rust/` |
| 打包输出 | `output/windows-x64/dir/`（绿色目录） |
| 安装程序 | `output/windows-x64/setup/NiuMa-<version>-x64-Setup.exe` |

## 常见问题

**`cmake not found`**  
安装 CMake 并确保在 PATH 中，或重新打开终端后执行 `pnpm setup:desktop`。

**`MSVC not found` / cmake 找不到 VS**  
打开 Visual Studio Installer，为已安装实例添加 **「使用 C++ 的桌面开发」** 或 **VC++ x64/x86 生成工具**，然后重试 `pnpm build:shell`。

**CEF 已存在但版本不对**  
删除 `third_party/cef/` 目录，执行 `pnpm cef:download`。

**窗口空白或秒退**  
查看 `build/shell/Release/debug.log`；确认 `resources/web/index.html` 存在（先 `pnpm build:web` 或 `pnpm dev` 完整构建）。

**`cefQuery unavailable`**  
说明当前在浏览器而非 CEF 中打开，请使用 `pnpm dev` 启动桌面应用。

**`cargo not found`**  
说明 Rust 未安装或 `~/.cargo/bin` 未进入 PATH。重新打开终端后执行 `cargo --version`；若仍失败，先安装 `Rustlang.Rustup` 再执行 `rustup toolchain install stable`。

**`Missing manifest in toolchain 'stable-x86_64-pc-windows-msvc'`**  
这是本机 Rust toolchain 损坏或未完成安装的典型报错。建议依次执行：

```powershell
rustup self uninstall -y
Remove-Item "$env:USERPROFILE\.rustup" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.cargo" -Recurse -Force -ErrorAction SilentlyContinue
winget install Rustlang.Rustup --accept-package-agreements --accept-source-agreements
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
rustup toolchain install stable
rustup default stable
cargo --version
```

若 `winget install Rustlang.Rustup` 长时间无响应，先结束残留 `winget` / `rustup-init` 进程后再重试。

## 文档

- [设计文档索引](docs/README.md)
- [总体架构](docs/01-architecture-overview.md)
- [CEF Shell（C++）](docs/02-shell-cpp-cef.md)
- [Web 层总览](docs/07-web-overview.md)
- [脚本平台分层方案](docs/17-script-platform-layout.md)
- [发布包目录布局](docs/pack-output-layout.md)
- [数据库规范](docs/database-schema.md)

## 仓库结构

```
NiuMa/
├── docs/                      # 架构与设计文档
├── scripts/
│   ├── setup-desktop.ps1      # 首次环境：CMake / MSVC / CEF
│   ├── build-shell.ps1        # 构建 CEF 壳 + 复制 web/dist
│   ├── dev.ps1                # 启动 niuma.exe
│   ├── download-cef.ps1
│   └── pack/                  # 打包脚本
├── scripts/sql/sqlite/        # SQL 迁移源脚本
├── third_party/cef/           # CEF 二进制（setup 后生成）
├── build/shell-<platform>-<arch>/  # CMake 壳层矩阵构建
├── build/shell/               # Windows 本机兼容同步目录
├── output/                    # 打包输出（如 output/windows-x64/dir/）
├── shell/                     # C++ CEF 壳层（Layer 3）
├── web/                       # Vue 3 主 Web 应用（Layer 4）
├── packages/rust/             # Rust 公共 crate（日志 / IPC 等）
├── packages/ui/               # @niuma/ui 组件库 + playground
├── platform/                  # Platform Core（Go，规划中）
├── services/ssh-service/      # SSH / SFTP 能力服务（Rust）
├── services/manifests/
├── plugins/
└── proto/
```

## 架构概要

```
Vue 3 Web  ──① CEF IPC──>  C++ Shell  ──② gRPC/Pipe──>  Platform / Services
 app://niuma/              niuma.exe
```

## 许可证

待定
