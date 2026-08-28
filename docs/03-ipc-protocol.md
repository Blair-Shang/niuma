# 03 — 应用 IPC 信封（Named Pipe / UDS）

> 版本：v1 · 日期：2026-08-24  
> 状态：**已落地**（Go `packages/go/serviceipc/envelope` · C++/Rust `serviceipc` · Web `BridgeError`）  
> 传输：**Windows Named Pipe / Unix Domain Socket** + **4 字节小端长度前缀 + UTF-8 JSON**。本机 IPC **不占用 TCP 端口**，也不是 gRPC。

关联：[11 — Platform Core](./11-platform-core.md) · [13 — 服务布局](./13-service-layout.md) · [14 — 能力连接](./14-capability-connection-framework.md)

---

## 1. 分层

| 层 | 本仓库实现 | 不做什么 |
|----|------------|----------|
| 传输 | Named Pipe / UDS | 不监听 `localhost:端口` |
| 分帧 | `protocol`：4 字节长度 + JSON 字节 | 不改业务方法名 |
| 信封 | 本文 `v` / `id` / `ok` / `error` / `errorCode` / `traceId` / `result` | 不把 SQL/SSH 语义写进信封 |

壳层 C++ 仍用极简 `JsonGetString`：`error` **必须是字符串**，`result` **必须是再编码一层的 JSON 字符串**。

---

## 2. 请求

```json
{
  "v": 1,
  "method": "mysql.session.open",
  "params": { "profileId": "…" },
  "id": "uuid",
  "traceId": "uuid"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `method` / `params` / `id` | 是 | 既有字段，行为不变 |
| `v` | 否 | 缺省视为 0（旧客户端） |
| `traceId` | 否 | 缺省时服务端用 `id` |

---

## 3. 响应

成功：

```json
{
  "v": 1,
  "id": "uuid",
  "ok": true,
  "traceId": "uuid",
  "result": "{\"sessionId\":\"…\"}"
}
```

失败（`error` 仍是字符串，禁止改成对象）：

```json
{
  "v": 1,
  "id": "uuid",
  "ok": false,
  "error": "method not found: foo",
  "errorCode": "method_not_found",
  "traceId": "uuid",
  "result": ""
}
```

Web 成功路径仍只收到内层 `result`（壳取出后 `callback->Success`）。失败时 cefQuery `onFailure` 载荷为：

```json
{ "v": 1, "error": "…", "errorCode": "method_not_found", "traceId": "uuid" }
```

`web/src/api/client.ts` 解析为 `BridgeError`；`error.message` 仍是人可读文本。

---

## 4. 稳定错误码

`snake_case` 字符串；新增只加，不改已有取值。

| `errorCode` | 典型文案前缀 |
|-------------|----------------|
| `method_not_found` | `method not found:` |
| `invalid_request` | `invalid request json` / `invalid method` |
| `invalid_params` | `invalid params:` |
| `cancelled` | `context canceled` / `cancelled` |
| `timeout` | `deadline exceeded` / `i/o timeout` / `wait timeout` |
| `lost` | `broken pipe` / `connection reset` / `driver: bad connection` 等传输断开 |
| `unavailable` | 含 `unavailable`（含 platform/service 不可达） |
| `engine_mismatch` | `use mariadb connection kind` / `use the matching connection kind`（Probe 拒接错误引擎） |
| `internal` | 其余未分类 |

金样例（Go / C++ / Rust 共用，改字段三边测试一起红）：`packages/go/serviceipc/envelope/golden/`。

业务可继续把细节放在 `error` 字符串里；不要靠改 `error` 的 JSON 类型来传码。

---

## 5. 兼容性

- **加字段、不加端口、不改 method**：旧端忽略未知字段；新端缺 `v` 当 v0。
- 安装包须 **壳 + platform-core + 各 service 同版本** 发布。
- 禁止把 `result` 改成嵌套对象（会破坏壳层 `JsonGetString`）。
- 失败日志须带 `id` / `traceId` / `errorCode`（各 handler `logDispatchError`）。
- 本机可观测（无 APM）：各跳 RPC 写入会话目录 `observe.jsonl`，用 `platform.diag.trace` 按 `traceId` 检索（见 [35](./35-desktop-observability.md)）。
- 本机 IPC **不上 gRPC、不定 TCP 端口**。
- 能力进程崩溃：platform supervisor 自动拉起，并推 `*.session.state` / `platform.service.state`；转储在会话日志 `crashes/`。
- RPC 客户端复用空闲管道（同时仍一请求一连接）。**仅当从池中取出的连接在写出阶段就失败时**换新连接重发同一帧；写出成功后再读失败禁止重发（对端可能已执行）。C++ 壳与 Go 客户端同一策略，因此 `query.cancel` 可与在途 `query.exec` 并行走第二条连接。事件 `*.progress` 合并为可丢批次；`session.state` / `transfer.state` 阻塞入队，禁止超时关连接把已排队状态冲掉。`ftp.dir.list` 未传 `limit` 不截断。失败码新增 `timeout` / `lost`（会话断开发 `{ns}.session.state`）。不上 gRPC、不改 `result` 类型。

---

## 6. 实现位置

| 语言 | 路径 |
|------|------|
| Go | `packages/go/serviceipc/envelope` |
| C++ | `packages/cpp/serviceipc` `MakeOkResponse` / `MakeFailResponse` |
| Rust | `packages/rust/niuma-serviceipc` `Response` |
| Web | `web/src/api/client.ts` `BridgeError` |
