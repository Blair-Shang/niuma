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

## 本地 Oracle（Docker）

远端库常有审计触发器 / 权限限制，不适合测 DDL。本目录提供 `docker-compose.yml`（`gvenzl/oracle-free`）：

```powershell
docker compose -f services/oracle-service/docker-compose.yml up -d
docker compose -f services/oracle-service/docker-compose.yml logs -f
# 看到 DATABASE IS READY TO USE! 后即可连接
```

| 项 | 值 |
|----|-----|
| Host | `127.0.0.1`（勿用 `localhost`，避免 IPv6） |
| Port | `61521`（容器内仍为 1521） |
| Service Name | `FREEPDB1` |
| 应用用户 | `niuma` / `Niuma123`（可建表） |
| 管理员 | `system` / `Oracle123` |

Docker 建议至少 **2GB** 内存。停止：`docker compose -f services/oracle-service/docker-compose.yml down`（加 `-v` 会清数据卷）。

## 构建

```powershell
.\scripts\shared\build\build-oracle-service.ps1
```

产物：
- 矩阵目录：`services/bin/windows-x64/niuma-oracle-service.exe`（供 `stage-services` / `dev:hot` 拷贝）
- 兼容平铺：`services/bin/niuma-oracle-service.exe`（本机 Windows）

`build-services.ps1` / `pnpm dev:hot` **默认**会调用本脚本重编 Oracle，并经 `stage-services` 拷到 `build/shell-*/…/services/bin/`。  
无 VS/CMake 的机器可传 `-SkipOracle`：`.\scripts\shared\build\build-services.ps1 -SkipOracle`。

## IPC

- Windows：`\\.\pipe\niuma.oracle`
- Unix：`/tmp/niuma.oracle.sock`
- 帧：4 字节小端长度 + UTF-8 JSON（与 Go `serviceipc` 一致）

P0 方法：`session.open|close|test`、`query.exec|fetch|close|cancel`。

## 许可

Instant Client 再分发须遵守 Oracle 条款；安装包需附带通知。ODPI-C 为 Apache/UPL 许可，见 upstream。
