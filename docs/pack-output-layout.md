# 发布包目录布局

> 安装包 / 绿色版解压后的**运行时结构**（Windows x64）  
> 绿色目录：`output/windows-x64/dir/`  
> 安装程序：`output/windows-x64/setup/NiuMa-<version>-windows-x64-Setup.exe`（`pnpm pack:win:setup` / `pnpm release:win`）

```
output/windows-x64/dir/
├── niuma.exe
├── chrome_elf.dll
├── libcef.dll
├── libEGL.dll
├── libGLESv2.dll
├── chrome_100_percent.pak
├── chrome_200_percent.pak
├── resources.pak
├── icudtl.dat
├── ...
├── resources/web/              # ← web/dist
├── platform/migrations/sqlite/ # ← scripts/sql/sqlite
├── services/manifests/
├── services/bin/
├── plugins/
└── locales/
```

## 用户数据（不在 pack/ 内）

| 平台 | 路径 |
|------|------|
| Windows | `%LOCALAPPDATA%\NiuMa\data\niuma.db` |
| macOS | `~/Library/Application Support/NiuMa/data/niuma.db` |
| Linux | `~/.local/share/NiuMa/data/niuma.db` |

## 构建中间目录

| 路径 | 用途 |
|------|------|
| `build/shell-<platform>-<arch>/` | CMake 壳层构建（Windows 兼容同步到 `build/shell/`） |
| `build/pack-staging/` | 打包临时目录 |
| `web/dist/` | Vite 输出 |
| `scripts/sql/sqlite/` | SQL **源**脚本 |
| `scripts/pack/` | 打包**脚本** |

## app:// 映射

| URL | 路径 |
|-----|------|
| `app://niuma/index.html` | `{exe_dir}/resources/web/index.html` |

## Linux / 麒麟 `.deb` 安装布局

生成路径：`output/linux-x64/deb/` 或 `output/kylin-x64/deb/`

安装后主要文件位于 `/opt/niuma/`（可通过 `--install-root` 调整）：

```
/opt/niuma/
├── niuma
├── libcef.so
├── libEGL.so
├── libGLESv2.so
├── v8_context_snapshot.bin
├── chrome-sandbox
├── *.pak
├── icudtl.dat
├── locales/
├── resources/web/
├── platform/migrations/sqlite/
├── services/
└── plugins/
```

`/usr/bin/niuma` 为启动器脚本，桌面项位于 `/usr/share/applications/niuma.desktop`（含 `StartupWMClass`）。  
`postinst` 将 `chrome-sandbox` 设为 `4755`（CEF 沙箱）。`.deb` 是主分发物；`Setup.run` 只是可选向导。`GPG_KEY_ID` 存在且本机有 `dpkg-sig`/`debsigs` 时给 `.deb` 签名。

## macOS `.app` 布局

生成路径：`output/macos-x64/dmg/`（含 `NiuMa.app` 与可选 `.dmg`）

```
NiuMa.app/Contents/
├── Info.plist
├── MacOS/niuma
├── Frameworks/
│   ├── Chromium Embedded Framework.framework/
│   ├── NiuMa Helper.app/
│   ├── NiuMa Helper (GPU).app/
│   ├── NiuMa Helper (Plugin).app/
│   ├── NiuMa Helper (Renderer).app/
│   └── NiuMa Helper (Alerts).app/
└── Resources/
    ├── web/
    ├── locales/
    ├── *.pak
    ├── icudtl.dat
    ├── platform/migrations/sqlite/
    ├── services/
    └── plugins/
```

macOS 用户数据目录：`~/Library/Application Support/NiuMa/`（运行时缓存等）。

## 构建约束

**本机构建 / 容器构建**：`build:*`、`pack:*`、`release:*` 须在目标操作系统本机（或同架构容器）执行；脚本会校验 `platform` 与 `arch` 与宿主机一致，不支持从 Windows 交叉打 Linux/macOS 包。

| 平台 | 推荐命令（在对应 OS 内） |
|------|--------------------------|
| Windows x64 | `pnpm release:win` |
| Windows arm64 | `pnpm cef:download`（自动选 windowsarm64）→ `pnpm release:win:arm64` |
| Linux | `pnpm release:linux` |
| 麒麟 | `pnpm release:kylin` |
| macOS | `pnpm release:macos` |

GitHub 托管流水线：推送 `v*` tag 或手动运行 **Pack and Release**（见 [scripts/README.md](../scripts/README.md) § GitHub Actions）。产物在 Actions Artifact 与 GitHub Release。

## Linux / 麒麟 GUI 安装程序

`pnpm pack:linux:setup` / `pnpm pack:kylin:setup` 在 `.deb` 基础上生成自解压 **`Setup.run`**：

- 双击或 `./NiuMa-*-linux-*-Setup.run` 启动图形向导（**zenity**，无 GUI 时回退文本模式）
- 欢迎 → 确认 → 输入管理员密码（**pkexec** / **sudo**）→ `dpkg -i` 安装
- 输出：`output/linux-x64/setup/NiuMa-<version>-linux-<arch>-Setup.run`

依赖（目标机器）：`dpkg`、`zenity`（GNOME/麒麟桌面通常已带）

## macOS GUI 安装程序

`pnpm pack:macos:setup` 在 `.app` 基础上生成 **`Setup.pkg`**：

- 双击 `.pkg` 启动 macOS 标准安装向导（欢迎页 → 继续 → 安装）
- 使用 `pkgbuild` + `productbuild`（系统自带）
- 输出：`output/macos-x64/setup/NiuMa-<version>-macos-<arch>-Setup.pkg`
- 可选：`CODESIGN_IDENTITY` 对 pkg 签名

`pack:macos` 会同步复制 `NiuMa.app` 到 `output/macos-x64/app/` 供安装包构建使用。

## Windows 安装程序

`pnpm release:win` 在绿色目录基础上，使用 **Inno Setup 6** 生成可分发 `Setup.exe`：

- 默认当前用户：`%LOCALAPPDATA%\Programs\NiuMa\`，不弹 UAC；向导可选「所有用户」写入 `C:\Program Files\NiuMa\`
- 控制面板可卸载；固定 `AppId` 覆盖升级
- 中英双语安装向导（须同意 Apache 2.0 附加声明才能继续）
- 企业静默：`NiuMa-<ver>-windows-x64-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`
- 有 `CODESIGN_CERT` 时签名 `niuma.exe` 与 `Setup.exe`；`REQUIRE_CODESIGN=1` 时未签名则失败
- Inno Setup 可免费用于商业产品（见其官方许可证）

中间产物：

| 路径 | 用途 |
|------|------|
| `build/pack-inno/niuma-setup.iss` | 生成的 Inno 脚本（可检查） |
| `output/windows-x64/setup/` | 最终 `NiuMa-*-Setup.exe` |
