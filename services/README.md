# Capability Services（Layer 1）

多语言独立进程，经应用 IPC 与 Shell / Platform 通信。

```
services/
├── manifests/           # service.yaml（platform-core supervisor 懒拉起）
├── bin/                 # 编译产物
│   └── runtime/         # 厂商 native 旁载（如 oracle Instant Client）
├── ftp-service/ …       # Go 能力服务
├── mysql-service/
├── sqlite-service/
├── dameng-service/
└── oracle-service/      # C++20 + ODPI-C（见 docs/29）
```

构建 Go 服务：

```powershell
.\scripts\shared\build\build-services.ps1
```

构建 Oracle（独立）：

```powershell
.\scripts\shared\build\build-oracle-service.ps1
```

目录与 manifest 规范见 [docs/13-service-layout.md](../docs/13-service-layout.md)、[docs/14-capability-connection-framework.md](../docs/14-capability-connection-framework.md)。
