# 36 — API 管理模块（Layer 1 能力服务）

> 版本：v0.1 · 日期：2026-09-01
> 状态：P0 已落地原始 TCP / UDP；HTTP / WebSocket / gRPC 后续再加

---

## 1. 目标与范围

面向 API 调试工作台（`web/src/modules/api-tester`）的 **Layer-1 协议执行进程**。
本期只做传输层套接字，对齐 Packet Sender、Hercules SETUP、netcat 的角色模型：

| 角色 | `kind` | 行为 |
|------|--------|------|
| TCP 客户端 | `tcp-client` | 拨号 → 长连接收发 |
| TCP 服务端 | `tcp-server` | 绑定端口 → 接受多个对端 → 按 `peerId` 收发 |
| UDP | `udp` | 绑定本机端口 → `sendto` / `recvfrom` |

不做：HTTP 语义、TLS、组播、应用层分帧（换行/长度前缀）。收到的字节按块上报，由上层再解释。

---

## 2. 分层

```
Web api-tester
  → cefQuery api.session.* / api.socket.*
    → platform-core CapabilityRegistry（namespace=api）
      → api-service（Named Pipe / UDS）
        → 本机 TCP / UDP
```

- **无** `connection_kind`：套接字按请求打开，不进运维连接树，也不走 Vault 凭据注入。
- 壳层与 platform **无需**新增 `*_proxy.go`。

---

## 3. 方法

Web 方法 = `api.` + 服务内方法。

| 方法 | 入参 | 返回 |
|------|------|------|
| `session.open` | `{ kind, host, port, localHost?, localPort?, timeoutMs?, encoding?, readLimit? }` | 会话快照 |
| `session.close` | `{ sessionId }` | `{ closed: true }` |
| `session.test` | 同 open | `{ ok, message }`（探测后立即释放） |
| `socket.send` | `{ sessionId, data, encoding?, peerId?, host?, port? }` | `{ bytesSent, at, peerId?, remoteAddr? }` |
| `socket.list` | `{}` | `{ sessions }` |
| `socket.peers` | `{ sessionId }` | `{ peers }`（仅 tcp-server） |
| `socket.kick` | `{ sessionId, peerId }` | `{ kicked: true }` |

### 3.1 地址约定

| kind | `host` / `port` | `localHost` / `localPort` |
|------|-----------------|---------------------------|
| tcp-client | 对端（必填） | 可选本机绑定 |
| tcp-server | 监听地址；`host` 空则 `0.0.0.0`，`port=0` 为临时端口 | 覆盖监听地址 |
| udp | 非通配时作为默认发送目的 | 绑定；未指定则 `0.0.0.0` + 临时端口。通配 `host` + `port` 表示监听该端口 |

`encoding`：`auto`（默认，成对十六进制走 hex，否则 utf8）/ `utf8` / `hex` / `base64`。hex 允许空格、冒号、`0x`。

### 3.2 TCP 服务端发送

- 仅一个对端时可省略 `peerId`（Hercules 单客户端便利）。
- 多个对端必须带 `peerId`。

### 3.3 UDP 发送

- 客户端：`host` / `port` 为默认 `sendto` 目的；也可在 `socket.send` 里覆盖。
- 服务端：打开时用 `localHost` / `localPort` 绑定（通配或指定网卡）。回包寄最近一次 `recvfrom` 的对端；`host` 为空或通配时忽略随绑端口传来的 `port`，避免把 `0.0.0.0:监听端口` 当成目的。
- 多个对端时由工作台传入点选的 `host` / `port`。

---

## 4. 事件

| type | 含义 |
|------|------|
| `api.session.state` | `connected` / `listening` / `accepted` / `closed` / `lost`；`accepted` 带 `peerId` |
| `api.socket.data` | 收发各记一条：`direction=in\|out`，始终带 `hex`，合法 UTF-8 才填 `data` |

状态与报文不丢；进度类事件才可丢（本服务暂无 progress）。

---

## 5. 限额

| 项 | 值 |
|----|----|
| 单帧载荷 | 1 MiB |
| 默认读缓冲 | 64 KiB |
| 同时会话 | 64 |
| 单监听对端 | 256 |
| 拨号超时 | 10 s（可用 `timeoutMs` 覆盖） |

---

## 6. 进程

- 目录：`services/api-service/`
- manifest：`services/manifests/api-service.yaml`
- 二进制：`services/bin/niuma-api-service.exe`
- IPC：`\\.\pipe\niuma.api` / `/tmp/niuma.api.sock`
- 启动：lazy

---

## 7. 工作台页签

每个请求对应一个 Shell Tab。TCP / UDP 打开后会话挂在该 `requestId` 上，切页签不断开；关 Tab、删请求或点「关闭」才 `session.close`。多页签可同时监听或拨号，事件按 `sessionId` 分流。明文 HTTP 仍是一发一收。

监听：地址为 `0.0.0.0` / `::` / `*`，或 `listen://host:port`。

## 8. 后续

HTTPS / TLS、WebSocket、UDP 广播/组播、按分隔符分帧。工作台明文 HTTP 在前端拼 HTTP/1.1，经 `api.session.open` + `api.socket.send` 发出。
