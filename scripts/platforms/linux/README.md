# Linux 平台脚本

本目录用于承载 **通用 Linux** 的运行、构建、打包、安装脚本。

建议后续按职责拆分：

```text
linux/
├── setup/
├── build/
├── run/
└── pack/
```

约定：

- 通用 Linux 逻辑先放这里
- 麒麟 / UOS 等发行版特化逻辑不要直接塞进本目录，改放各自平台目录覆盖
- 平台无关逻辑应优先放 `scripts/shared/`

当前已接入：

- `setup/install-toolchain.sh`：工具链检查 + CEF 下载
- `setup/download-cef.sh`：从官方 index.json 下载 Linux CEF Standard 包
- `run/dev.sh` / `run/dev-platform.sh`：开发运行入口
- `build/build-shell.sh`：壳层构建（要求 CEF，校验 `libcef.so`）
- `pack/pack-linux.sh`：Debian 安装包组装（捆绑 CEF 运行时），输出 `.deb` 或解包目录
