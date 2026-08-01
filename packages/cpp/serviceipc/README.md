# niuma_serviceipc（C++）

Layer-1 能力服务应用 IPC 公共库，对标：

- `packages/go/serviceipc`
- `packages/rust/niuma-serviceipc`

## 契约

- 传输：Windows Named Pipe / Unix Domain Socket  
- 分帧：4 字节小端长度 + UTF-8 JSON（`kMaxFrameSize = 16 MiB`）  
- 信封：`{ method, params, id }` → `{ id, ok, error?, result }`（`result` 为嵌套 JSON 字符串）

## 使用

```cmake
add_subdirectory(${NIUMA_ROOT}/packages/cpp/serviceipc serviceipc)
target_link_libraries(my-cpp-service PRIVATE niuma::serviceipc)
```

```cpp
#include <niuma/serviceipc/server.hpp>

niuma::serviceipc::Server server(
    R"(\\.\pipe\niuma.my)",
    [](const std::string& req) { return dispatcher.HandleFrame(req); },
    "my-service");
return server.Serve();
```

业务服务只实现 Dispatcher；**不要**再复制 frame/server。

## 测试

```powershell
cmake -S packages/cpp/serviceipc -B packages/cpp/serviceipc/build
cmake --build packages/cpp/serviceipc/build --config Release
ctest --test-dir packages/cpp/serviceipc/build -C Release --output-on-failure
```

或由 `oracle-service` 构建脚本一并拉取（`add_subdirectory`）。

## 跨平台

| 平台 | 实现 |
|------|------|
| Windows | Named Pipe（`NIUMA_SERVICEIPC_WIN`） |
| Linux / 麒麟 / macOS | Unix Domain Socket（`NIUMA_SERVICEIPC_UNIX`） |

CMake 按 `WIN32` 自动切换；各服务只需传平台对应的 `ipc.address`。
