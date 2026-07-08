# Capability Services（Layer 1）

多语言独立进程，经应用 IPC 与 Shell / Platform 通信。

```
services/
├── manifests/           # service.yaml
│   ├── platform-core.yaml   # Layer 2 注册契约（com.niuma.platform；壳层硬编码镜像）
│   └── ftp-service.yaml     # platform-core supervisor 懒拉起
├── bin/                 # 编译产物（打包时复制到 output/.../services/bin/）
│   ├── platform-core.exe
│   └── ftp-service.exe
└── ftp-service/         # FTP 能力服务（Go 独立模块）
```

构建全部 Go 服务：

```powershell
.\scripts\build-services.ps1
```

目录与 manifest 规范见 [docs/13-service-layout.md](../docs/13-service-layout.md)、[docs/14-capability-connection-framework.md](../docs/14-capability-connection-framework.md)。

实现阶段按模块新增：`ssh-service/`、`db-mysql/` 等。
