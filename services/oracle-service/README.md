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

运行时探测顺序：

1. `ORACLE_HOME` / `ORACLE_HOME/bin`（标准 Oracle 客户端变量；可由工具组件注入）
2. 旁载 `services/bin/runtime/oracle/`（相对服务 exe，可选）
3. PATH 中含 `oci.dll` 的目录（Windows）

开发机可将 Instant Client Basic（或 Basic Light）解压后设置 `ORACLE_HOME`，
或在应用内 **设置 → 工具组件 → Oracle Instant Client** 浏览选择 `oci.dll`。

产品默认**不**捆绑 Instant Client；亦**不**做应用内代下载（见 `docs/29-oracle-module.md`）。

## 构建

```powershell
.\scripts\shared\build\build-oracle-service.ps1
```

产物：
- 矩阵目录：`services/bin/windows-x64/niuma-oracle-service.exe`（供 `stage-services` / `dev:hot` 拷贝）
- 兼容平铺：`services/bin/niuma-oracle-service.exe`（本机 Windows）

常规 `build-services.ps1` **不**强制构建本服务（避免无 VS / cmake 的开发机失败）。构建后需再跑一次壳层 stage（或重启 `pnpm run dev:hot`）才会出现在 `build/shell-*/Release/services/bin/`。

## IPC

- Windows：`\\.\pipe\niuma.oracle`
- Unix：`/tmp/niuma.oracle.sock`
- 帧：4 字节小端长度 + UTF-8 JSON（与 Go `serviceipc` 一致）

P0 方法：`session.open|close|test`、`query.exec|fetch|close|cancel`。

## 许可

Instant Client 再分发须遵守 Oracle 条款；安装包需附带通知。ODPI-C 为 Apache/UPL 许可，见 upstream。
