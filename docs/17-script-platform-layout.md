# 17 — 脚本平台分层与重构方案

> 版本：v0.1 · 日期：2026-07-07
> 状态：已落地首版；本文定义 `scripts/` 的平台分层方案与迁移路径

---

## 1. 背景

当前仓库的脚本主要集中在 `scripts/` 根目录，虽然在 Windows 开发链路上可用，但存在以下问题：

1. **通用逻辑与平台逻辑耦合**
   - `build-services.ps1`、`build-shell.ps1`、`setup-desktop.ps1` 混在同一层
   - Windows 的 `winget`、MSVC、`.exe` 命名、CEF 下载逻辑直接暴露给所有入口

2. **后续扩平台成本高**
   - Linux / 麒麟 / macOS 进入后，若继续在单脚本内堆 `if/else`，维护会迅速恶化

3. **构建、运行、打包、安装边界不清**
   - “构建服务”本应平台弱相关
   - “壳构建 / 打包 / 安装”则强平台相关

因此需要把脚本体系重构为：**统一入口层 + 通用层 + 平台层**。

---

## 2. 重构目标

重构后的脚本体系应满足：

- 日常命令入口统一，不要求开发者记平台内部路径
- 平台无关逻辑只保留一份
- 平台特化逻辑明确归属到 `platforms/<os>/`
- 支持 Linux 通用层 + 麒麟等发行版覆盖层
- 保持现有 Windows 开发链路可用，并消除根目录双份脚本维护

---

## 3. 分层原则

### 3.1 统一入口层（`scripts/entry/`）

职责：

- 对外暴露稳定命令入口
- 做平台检测与分发
- 不承载具体平台业务逻辑

典型入口：

- `entry/dev.ps1`
- `entry/dev-platform.ps1`
- `entry/setup.ps1`
- `entry/build.ps1`
- `entry/pack.ps1`
- `entry/cef-download.ps1`
- `entry/dev.sh`
- `entry/dev-platform.sh`
- `entry/setup.sh`
- `entry/build.sh`
- `entry/pack.sh`
- `entry/cef-download.sh`

### 3.2 通用层（`scripts/shared/`）

职责：

- 存放平台无关逻辑
- 供多个平台共用
- 尽量不出现平台专属命名与打包工具依赖

典型内容：

- 服务构建
- 停服务
- 服务分发 / stage
- 路径解析
- 版本注入
- manifest 检查
- 运行时目录组装

### 3.3 平台层（`scripts/platforms/`）

职责：

- 存放强平台相关逻辑
- 按 OS 家族或发行版拆分
- 处理构建壳层、安装依赖、打包、签名、公证等问题

当前与未来规划：

```text
scripts/platforms/
├── windows/
├── linux/
├── kylin/
└── macos/
```

---

## 4. 推荐目录结构

```text
scripts/
├── entry/
│   ├── build.ps1
│   ├── build.sh
│   ├── cef-download.ps1
│   ├── dev.ps1
│   ├── pack.ps1
│   └── setup.ps1
├── shared/
│   ├── lib/
│   │   ├── common.sh
│   │   └── matrix.ps1
│   ├── build/
│   │   ├── build-services.ps1
│   │   └── build-services.sh
│   ├── package/
│   │   ├── stage-services.ps1
│   │   └── stage-services.sh
│   └── tasks/
│       └── stop-services.ps1
├── platforms/
│   ├── windows/
│   │   ├── build/
│   │   │   └── build-shell.ps1
│   │   ├── pack/
│   │   │   └── bundle-windows.ps1
│   │   ├── run/
│   │   │   └── dev.ps1
│   │   └── setup/
│   │       ├── download-cef.ps1
│   │       └── setup-desktop.ps1
│   ├── linux/
│   ├── kylin/
│   └── macos/
├── pack/              # 打包说明文档
├── sql/
└── README.md
```

---

## 5. 当前已落地改动

本次已完成：

### 5.1 新增统一入口

- `scripts/entry/dev.ps1`
- `scripts/entry/setup.ps1`
- `scripts/entry/build.ps1`
- `scripts/entry/pack.ps1`
- `scripts/entry/cef-download.ps1`

### 5.2 新增通用层实现

- `scripts/shared/build/build-services.ps1`
- `scripts/shared/build/build-services.sh`
- `scripts/shared/tasks/stop-services.ps1`
- `scripts/shared/package/stage-services.ps1`

### 5.3 新增 Windows 平台层实现

- `scripts/platforms/windows/run/dev.ps1`
- `scripts/platforms/windows/run/dev-platform.ps1`
- `scripts/platforms/windows/setup/setup-desktop.ps1`
- `scripts/platforms/windows/setup/download-cef.ps1`
- `scripts/platforms/windows/build/build-shell.ps1`
- `scripts/platforms/windows/build/generate-app-icon.ps1`
- `scripts/platforms/windows/pack/bundle-windows.ps1`

### 5.4 新增 Linux / 麒麟 / macOS 平台脚手架与打包链路

已补齐可分发的标准骨架脚本：

- `scripts/platforms/linux/README.md`
- `scripts/platforms/linux/setup/install-toolchain.sh`
- `scripts/platforms/linux/setup/download-cef.sh`
- `scripts/platforms/linux/build/build-shell.sh`
- `scripts/platforms/linux/run/dev.sh`
- `scripts/platforms/linux/run/dev-platform.sh`
- `scripts/platforms/linux/pack/pack-linux.sh`
- `scripts/platforms/linux/pack/templates/*`
- `scripts/platforms/kylin/README.md`
- `scripts/platforms/kylin/setup/install-toolchain.sh`
- `scripts/platforms/kylin/setup/install-kylin-deps.sh`
- `scripts/platforms/kylin/setup/download-cef.sh`
- `scripts/platforms/kylin/build/build-shell.sh`
- `scripts/platforms/kylin/run/dev.sh`
- `scripts/platforms/kylin/run/dev-platform.sh`
- `scripts/platforms/kylin/pack/pack-kylin.sh`
- `scripts/platforms/macos/README.md`
- `scripts/platforms/macos/setup/install-toolchain.sh`
- `scripts/platforms/macos/setup/download-cef.sh`
- `scripts/platforms/macos/build/build-shell.sh`
- `scripts/platforms/macos/run/dev.sh`
- `scripts/platforms/macos/run/dev-platform.sh`
- `scripts/platforms/macos/pack/pack-macos.sh`

### 5.5 `package.json` 已切换入口

以下命令已改为走 `scripts/entry/`：

- `pnpm dev`
- `pnpm dev:hot`
- `pnpm dev:hot:ext-platform`
- `pnpm setup:desktop`
- `pnpm build:shell`
- `pnpm build:services`
- `pnpm pack:win`
- `pnpm cef:download`

---

## 6. 当前落地状态

当前结构已经完成首版收敛：

```text
package.json -> scripts/entry/* -> scripts/platforms/windows/* 或 scripts/shared/*
```

其中：

- `scripts/shared/build/build-services.ps1` / `scripts/shared/build/build-services.sh` 是**真实实现**
- 服务构建已统一接受 `platform + arch + configuration`
- 服务矩阵产物目录统一为 `services/bin/<platform>-<arch>/`
- 壳层矩阵产物目录统一为 `build/shell-<platform>-<arch>/`（Windows 为 `<Configuration>/niuma.exe`）
- 打包默认输出目录统一为 `output/<platform>-<arch>/<format>/`
- 当前 Windows 主机为兼容现有 `dev/build-shell` 链路，会额外同步一份到平铺的 `services/bin/*.exe` 与 `build/shell/<Configuration>/`
- `scripts/shared/tasks/stop-services.ps1` 是**真实实现**
- `scripts/shared/package/stage-services.ps1` 是**真实实现**
- `scripts/platforms/windows/run/*` 是**Windows 运行真实实现**
- `scripts/platforms/windows/build/*` 是**Windows 构建真实实现**
- `scripts/platforms/windows/setup/*` 是**Windows 环境准备真实实现**
- `scripts/platforms/windows/pack/*` 是**Windows 打包真实实现**
- 根目录历史 `.ps1` 脚本已全部移除，不再保留兼容跳转层

---

## 7. 平台划分建议

### 7.1 不建议直接按 `windows64 / linux64`

原因：

- 把 OS 与架构耦合在同一层，不利于未来 `arm64`
- `麒麟` 本质上是 Linux 发行版，不是和 `linux` 平级的“内核”

### 7.2 建议拆成 3 维

| 维度 | 示例 |
|------|------|
| OS | `windows` / `linux` / `macos` |
| distro | `kylin` / `uos` / `ubuntu` |
| arch | `x64` / `arm64` |

输出目录可体现这三个维度，例如：

```text
output/
├── windows-x64/
├── linux-x64/
├── kylin-x64/
└── macos-arm64/
```

---

## 8. 哪些逻辑应该进 `shared/`

适合抽到 `shared/` 的逻辑：

- `build-services`
- 停服务
- manifest 校验
- 跨平台 manifest 字段选择（如 `executable_windows` / `executable_unix`、`address_windows` / `address_unix`）
- SQL 迁移同步
- 运行时目录装配
- 版本号生成
- 产物复制

不应放进 `shared/` 的逻辑：

- `winget`
- MSVC 检查
- CEF 下载参数
- `.exe`、`.app`、`deb/rpm`、`dmg` 打包
- 平台签名 / 公证 / 安装器逻辑

---

## 9. 后续平台接入建议

### 9.1 Linux

当前已具备：

- `platforms/linux/setup/install-toolchain.sh`
- `platforms/linux/setup/download-cef.sh`
- `platforms/linux/build/build-shell.sh`
- `platforms/linux/run/dev.sh`
- `platforms/linux/run/dev-platform.sh`
- `platforms/linux/pack/pack-linux.sh`

下一步重点：

- 接入真实 CEF / Chromium 运行时下载
- 接入真实 shell 构建命令
- 已支持 `.deb` 目录组装，并在存在 `dpkg-deb` 时输出 `.deb`
- 已支持 Unix 版 `services/bin/niuma-*` 构建与 stage
- 继续补 `rpm` / `AppImage`

### 9.2 麒麟

当前已按 `linux` 之上覆盖实现：

- `platforms/kylin/setup/install-toolchain.sh`
- `platforms/kylin/setup/install-kylin-deps.sh`
- `platforms/kylin/setup/download-cef.sh`
- `platforms/kylin/build/build-shell.sh`
- `platforms/kylin/run/dev.sh`
- `platforms/kylin/run/dev-platform.sh`
- `platforms/kylin/pack/pack-kylin.sh`

当前打包行为：

- 复用 Linux Debian 打包链路
- 注入麒麟发行版包名与维护者标识

适合覆盖的内容：

- 包管理器依赖
- 桌面环境依赖
- 安装包格式
- 发行版规范路径

### 9.3 macOS

当前已具备基础脚手架，后续需要重点处理：

- `platforms/macos/setup/install-toolchain.sh`
- `platforms/macos/setup/download-cef.sh`
- `platforms/macos/build/build-shell.sh`
- `platforms/macos/run/dev.sh`
- `platforms/macos/run/dev-platform.sh`
- `platforms/macos/pack/pack-macos.sh`
- 已支持 `.app` 目录组装，并在存在 `hdiutil` 时输出 `.dmg`
- 签名
- notarization
- `.pkg` 产物

---

## 10. 建议的下一步迁移顺序

### Phase 1：已完成

- 建立 `entry / shared / platforms/windows`
- `package.json` 切到新入口
- 补齐 `platforms/linux` / `platforms/kylin` / `platforms/macos` 标准脚手架
- 将服务构建、停服、stage 分发逻辑收口到 `shared/`
- 将 Windows 的 `dev / build-shell / setup-desktop / download-cef / pack` 收口到 `platforms/windows/`
- 将 `dev-debug / dev-platform / generate-app-icon` 也收口到 `entry` 或 `platforms/windows/`
- 删除根目录历史 `.ps1` 脚本，消除双份维护

### Phase 2：继续抽出真正的通用逻辑

优先从这些脚本中抽：

- `build-services.ps1`
- `stop-niuma-services.ps1`
- `stage-services.ps1`
- 壳层构建中的通用辅助函数（若未来 Linux/macOS 复用）
- 开发运行中的平台无关辅助逻辑（如日志、Vite 就绪探测）

### Phase 3：收敛共享辅助库

建议继续把 Windows build/run 中可复用的辅助函数抽到：

```text
scripts/shared/lib/
```

例如：

- Vite 就绪探测
- 日志目录与环境变量装配
- CMake / VS 探测辅助
- 输出与错误格式化

### Phase 4：接入 Linux / 麒麟 / macOS

- 先把入口分发打通
- 再逐步补平台实现

---

## 11. 对当前仓库的建议结论

NiuMa 最合理的脚本体系是：

- `scripts/entry/`：统一入口
- `scripts/shared/`：通用逻辑
- `scripts/platforms/`：平台实现

这样能兼顾：

- 当前 Windows 开发效率
- 后续 Linux / 麒麟 / macOS 扩展
- 壳层强平台相关、服务层逐步跨平台的架构事实

---

## 12. 相关文档

- [README.md](../README.md)
- [scripts/README.md](../scripts/README.md)
- [01-architecture-overview.md](./01-architecture-overview.md)
- [16-ssh-sftp-module.md](./16-ssh-sftp-module.md)
