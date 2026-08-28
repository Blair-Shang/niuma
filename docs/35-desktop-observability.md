# 35 — 桌面本机可观测（无 APM）

> 版本：v1 · 日期：2026-08-25  
> 状态：**已落地**（`observe.jsonl` + `platform.diag.*` + 设置 · 运行时）

关联：[03 — IPC 信封](./03-ipc-protocol.md) · [11 — Platform Core](./11-platform-core.md)

本机桌面应用不上 Jaeger / SkyWalking / 云 APM。可观测 = **同一会话日志目录**里能按 `traceId` 把一次操作的各跳翻出来，并看慢调用与崩溃是否重复。

---

## 1. 落盘

壳启动时创建会话目录并设置 `NIUMMA_LOG_DIR`（见壳 `InitSessionLog`）。各进程日志仍写 `<service>.log`；**RPC 观测**追加到同目录 `observe.jsonl`（100 MiB 滚动为 `.1`）。

一行一例（不含 SQL 正文、不含 `result`）：

```json
{"ts":"2026-08-25T02:00:00.123","kind":"rpc","service":"mysql-service","method":"mysql.query.exec","id":"…","traceId":"…","ok":false,"errorCode":"timeout","durationMs":30001}
```

| 进程 | 写入点 |
|------|--------|
| C++ 壳 | `PlatformClient::Invoke`（管道不可达时 `errorCode=unavailable`） |
| Platform | `platform/internal/server` 每帧 |
| Go L1 | `packages/go/serviceipc/server` 每帧 |
| Rust L1（SSH / Redis） | `niuma-serviceipc` 每帧 |
| Oracle（C++） | `oracle-service` `HandleFrame` 外包一层 |

`platform.diag.*` 自身不写入，避免检索递归。

慢调用阈值：**200ms**（仅汇总展示，仍记录每一跳）。

崩溃转储仍在 `crashes/`。Go 文本栈按前若干帧哈希聚类；Windows minidump 按文件名归组。

---

## 2. 本机查询（IPC，不定端口）

| method | 入参 | 结果 |
|--------|------|------|
| `platform.diag.trace` | `{ traceId, limit? }` | `{ dir, events }` |
| `platform.diag.summary` | `{ limit? }` | 次数 / 失败 / 慢调用 / 按方法与 errorCode 聚合 / 最慢若干条 |
| `platform.diag.crashes` | `{}` | `{ dir, groups: [{ signature, service, count, samplePath }] }` |

Web：设置 → **运行时**；`web/src/api/diag.ts`。也可对会话目录 `observe.jsonl` 按 `traceId` 本地 grep。

---

## 3. 不做什么

- 不上报云端、不采样导出、不引入 OpenTelemetry Collector
- 不改信封 `result` 类型、不上 gRPC、不定 TCP 端口
- 不把查询结果或密码写入 `observe.jsonl`
