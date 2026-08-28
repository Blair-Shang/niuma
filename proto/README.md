# 应用 IPC 契约

本目录**不作为**当前跨进程契约。NiuMa 桌面端应用 IPC 已落地为：

- 传输：Named Pipe（Windows）/ UDS（其他平台），**不定 TCP 端口**
- 分帧：4 字节小端长度前缀 + UTF-8 JSON
- 信封：见 [docs/03-ipc-protocol.md](../docs/03-ipc-protocol.md) 与 `packages/go/serviceipc/envelope`

请勿在此添加 gRPC `.proto` 或规划「升级为 gRPC」。
