# macOS 平台脚本

本目录用于承载 macOS 的运行、构建、打包、签名、公证脚本。

建议后续按职责拆分：

```text
macos/
├── setup/
├── build/
├── run/
└── pack/
```

重点关注：

- `.app` 目录结构
- 签名与 notarization
- `dmg` 产物
- Apple Silicon / Intel 双架构适配

当前已接入：

- `setup/install-toolchain.sh` / `setup/download-cef.sh`（官方 CEF Standard 下载）
- `run/dev.sh` / `run/dev-platform.sh`
- `build/build-shell.sh`（要求 CEF framework）
- `pack/pack-macos.sh`：组装 `.app` 并捆绑 CEF Framework；`hdiutil` 可用时生成 `.dmg`；支持 `CODESIGN_IDENTITY` 签名
