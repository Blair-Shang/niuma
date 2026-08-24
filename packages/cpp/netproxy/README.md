# niuma_netproxy（C++）

能力服务共用 HTTP CONNECT / SOCKS4 / SOCKS4a / SOCKS5 代理拨号与本地转发，对标：

- `packages/go/netproxy`
- `packages/rust/niuma-netproxy`

## 用途

部分客户端库（如 Oracle ODPI）无法注入自定义 TCP dialer。`StartRelay` 在 `127.0.0.1` 监听随机端口，把入站连接经代理转到真实目标；业务侧把连接串改写为本地地址即可。

## 使用

```cmake
add_subdirectory(${NIUMA_ROOT}/packages/cpp/netproxy netproxy)
target_link_libraries(my-cpp-service PRIVATE niuma::netproxy)
```

```cpp
#include <niuma/netproxy/netproxy.hpp>

niuma::netproxy::Options proxy;
proxy.type = "socks5";
proxy.host = "127.0.0.1";
proxy.port = 1080;

std::string local_host;
uint16_t local_port = 0;
std::string error;
auto guard = niuma::netproxy::StartRelay(proxy, "db.example.com", 1521, local_host, local_port, error);
// 客户端改连 local_host:local_port；会话结束前持有 guard。
```

`Options` 由调用方从 `connection_options.proxy` JSON 填充；本库**不**依赖 nlohmann/json。

## 与隧道的关系

SSH 隧道见 `packages/cpp/sshtunnel`（对标 `packages/go/tunnel` / `packages/rust/niuma-tunnel`）。
与代理互斥时，业务侧通常优先隧道；本库的 `Dial` 可供隧道在连接跳板时复用。
