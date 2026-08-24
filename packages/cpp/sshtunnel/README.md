# niuma_sshtunnel（C++）

能力服务共用 SSH direct-tcpip 本地转发，对标：

- `packages/go/tunnel`
- `packages/rust/niuma-tunnel`

## 用途

客户端库无法注入自定义 dialer（如 ODPI）时：在 `127.0.0.1` 监听随机端口，经 SSH 跳板转发到真实目标；业务侧把连接串改写为本地地址，并在会话生命周期内持有 `TunnelGuard`。

平台侧只负责 `tunnel.sshProfileId` → `sshProfile` 注入；**隧道生命周期由各能力服务持有**。

## 使用

```cmake
add_subdirectory(${NIUMA_ROOT}/packages/cpp/netproxy netproxy)
add_subdirectory(${NIUMA_ROOT}/packages/cpp/sshtunnel sshtunnel)
target_link_libraries(my-cpp-service PRIVATE niuma::sshtunnel)
```

```cpp
#include <niuma/sshtunnel/sshtunnel.hpp>

niuma::sshtunnel::Options tunnel;
tunnel.type = "ssh";
tunnel.has_ssh_profile = true;
tunnel.ssh_profile.host_address = "jump.example.com";
tunnel.ssh_profile.login_account = "ops";
tunnel.ssh_profile.secret = "...";
tunnel.ssh_profile.auth_type = "password";

std::string local_host;
uint16_t local_port = 0;
std::string error;
auto guard = niuma::sshtunnel::StartSSHTunnel(tunnel, "db.internal", 1521, local_host, local_port, error);
```

依赖 libssh2（CMake FetchContent；Windows 默认 WinCNG，其它平台 OpenSSL）。
