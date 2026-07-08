# 麒麟平台脚本

本目录用于承载 **麒麟（Kylin）发行版特化** 的运行、构建、打包、安装脚本。

定位：

- 不是替代 `scripts/platforms/linux/`
- 而是在通用 Linux 脚本之上做发行版覆盖

适合放在这里的内容：

- 麒麟依赖安装
- 特定桌面环境 / 系统库检查
- `deb` 包装规范差异
- 安装路径与桌面集成差异

当前已接入：

- `setup/install-toolchain.sh` / `setup/install-kylin-deps.sh`
- `setup/download-cef.sh`
- `run/dev.sh` / `run/dev-platform.sh`
- `build/build-shell.sh`
- `pack/pack-kylin.sh`：复用 Linux Debian 打包链路，并附加麒麟发行版包名/维护者标识
