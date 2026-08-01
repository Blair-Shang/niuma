# oracle-service（C++20 + ODPI-C）

Layer-1 Oracle 能力服务。设计见 [docs/29-oracle-module.md](../../docs/29-oracle-module.md)。

## 依赖

| 组件 | 位置 | 说明 |
|------|------|------|
| **niuma_serviceipc** | `packages/cpp/serviceipc` | 公共 IPC（帧 + Pipe/UDS）；后续 C++ 服务复用 |
| ODPI-C | `third_party/odpi` | 构建期源码编进二进制 |
| nlohmann/json | `third_party/nlohmann/json.hpp` | 业务 JSON |
| Instant Client | `services/bin/runtime/oracle/` | **运行时**旁载；不可静态链进 exe |

拉取 ODPI（若目录不存在）：

```powershell
git clone --depth 1 --branch v5.4.1 https://github.com/oracle/odpi.git third_party/odpi
```

将 Oracle Instant Client Basic（或 Basic Light）解压到：

```
services/bin/runtime/oracle/
```

或设置环境变量 `NIUMA_ORACLE_RUNTIME` / `ORACLE_HOME` 指向该目录。

## 构建

```powershell
.\scripts\shared\build\build-oracle-service.ps1
```

产物：`services/bin/niuma-oracle-service.exe`（Windows）。

常规 `build-services.ps1` **不**强制构建本服务（避免无 Instant Client / VS 的开发机失败）。

## IPC

- Windows：`\\.\pipe\niuma.oracle`
- Unix：`/tmp/niuma.oracle.sock`
- 帧：4 字节小端长度 + UTF-8 JSON（与 Go `serviceipc` 一致）

P0 方法：`session.open|close|test`、`query.exec|fetch|close|cancel`。

## 许可

Instant Client 再分发须遵守 Oracle 条款；安装包需附带通知。ODPI-C 为 Apache/UPL 许可，见 upstream。
