#include <niuma/netproxy/netproxy.hpp>

#include <array>
#include <cerrno>
#include <cstring>
#include <mutex>
#include <vector>

#ifdef NIUMA_NETPROXY_WIN
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
using Sock = SOCKET;
constexpr Sock kInvalidSock = INVALID_SOCKET;
using socklen_t = int;
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
using Sock = int;
constexpr Sock kInvalidSock = -1;
#endif

namespace niuma::netproxy {
namespace {

constexpr size_t kHttpConnectReadLimit = 16 * 1024;

#ifdef NIUMA_NETPROXY_WIN
std::once_flag g_wsa_once;
bool EnsureWinsock(std::string& error) {
  static bool ok = false;
  static std::string init_err;
  std::call_once(g_wsa_once, [] {
    WSADATA data{};
    const int rc = WSAStartup(MAKEWORD(2, 2), &data);
    if (rc != 0) {
      init_err = "netproxy: WSAStartup failed: " + std::to_string(rc);
      ok = false;
    } else {
      ok = true;
    }
  });
  if (!ok) {
    error = init_err.empty() ? "netproxy: winsock init failed" : init_err;
  }
  return ok;
}
#else
bool EnsureWinsock(std::string&) { return true; }
#endif

void CloseSock(Sock fd) {
  if (fd == kInvalidSock) {
    return;
  }
#ifdef NIUMA_NETPROXY_WIN
  closesocket(fd);
#else
  close(fd);
#endif
}

bool SetCloexec(Sock fd) {
#ifdef NIUMA_NETPROXY_WIN
  (void)fd;
  return true;
#else
  const int flags = fcntl(fd, F_GETFD);
  if (flags < 0) {
    return false;
  }
  return fcntl(fd, F_SETFD, flags | FD_CLOEXEC) == 0;
#endif
}

std::string LastSockError(const char* prefix) {
#ifdef NIUMA_NETPROXY_WIN
  return std::string(prefix) + ": " + std::to_string(WSAGetLastError());
#else
  return std::string(prefix) + ": " + std::strerror(errno);
#endif
}

bool SendAll(Sock fd, const void* data, size_t len) {
  const auto* p = static_cast<const char*>(data);
  size_t sent = 0;
  while (sent < len) {
#ifdef NIUMA_NETPROXY_WIN
    const int n = send(fd, p + sent, static_cast<int>(len - sent), 0);
#else
    const ssize_t n = send(fd, p + sent, len - sent, 0);
#endif
    if (n <= 0) {
      return false;
    }
    sent += static_cast<size_t>(n);
  }
  return true;
}

bool RecvExact(Sock fd, void* data, size_t len) {
  auto* p = static_cast<char*>(data);
  size_t got = 0;
  while (got < len) {
#ifdef NIUMA_NETPROXY_WIN
    const int n = recv(fd, p + got, static_cast<int>(len - got), 0);
#else
    const ssize_t n = recv(fd, p + got, len - got, 0);
#endif
    if (n <= 0) {
      return false;
    }
    got += static_cast<size_t>(n);
  }
  return true;
}

Sock ConnectTcp(const std::string& host, uint16_t port, std::string& error) {
  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  hints.ai_protocol = IPPROTO_TCP;
  addrinfo* res = nullptr;
  const std::string port_text = std::to_string(port);
  const int gai = getaddrinfo(host.c_str(), port_text.c_str(), &hints, &res);
  if (gai != 0 || res == nullptr) {
    error = "netproxy: resolve failed: " + host;
    return kInvalidSock;
  }
  Sock fd = kInvalidSock;
  for (addrinfo* it = res; it != nullptr; it = it->ai_next) {
    fd = static_cast<Sock>(socket(it->ai_family, it->ai_socktype, it->ai_protocol));
    if (fd == kInvalidSock) {
      continue;
    }
    SetCloexec(fd);
    if (connect(fd, it->ai_addr, static_cast<int>(it->ai_addrlen)) == 0) {
      freeaddrinfo(res);
      return fd;
    }
    CloseSock(fd);
    fd = kInvalidSock;
  }
  freeaddrinfo(res);
  error = LastSockError("netproxy: connect");
  return kInvalidSock;
}

std::string Base64Encode(const std::string& input) {
  static constexpr char kTable[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((input.size() + 2) / 3) * 4);
  for (size_t i = 0; i < input.size(); i += 3) {
    const unsigned char b0 = static_cast<unsigned char>(input[i]);
    const unsigned char b1 = (i + 1 < input.size()) ? static_cast<unsigned char>(input[i + 1]) : 0;
    const unsigned char b2 = (i + 2 < input.size()) ? static_cast<unsigned char>(input[i + 2]) : 0;
    out.push_back(kTable[b0 >> 2]);
    out.push_back(kTable[((b0 & 0x03) << 4) | (b1 >> 4)]);
    out.push_back(i + 1 < input.size() ? kTable[((b1 & 0x0F) << 2) | (b2 >> 6)] : '=');
    out.push_back(i + 2 < input.size() ? kTable[b2 & 0x3F] : '=');
  }
  return out;
}

bool DialHttp(const Options& proxy, const std::string& host, uint16_t port, Sock& out, std::string& error) {
  out = ConnectTcp(proxy.host, static_cast<uint16_t>(proxy.PortOrDefault()), error);
  if (out == kInvalidSock) {
    return false;
  }
  const std::string target = host + ":" + std::to_string(port);
  std::string req = "CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n";
  if (!proxy.username.empty()) {
    req += "Proxy-Authorization: Basic " + Base64Encode(proxy.username + ":" + proxy.password) + "\r\n";
  }
  req += "\r\n";
  if (!SendAll(out, req.data(), req.size())) {
    error = "netproxy: http CONNECT write failed";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  std::vector<char> buf;
  buf.reserve(512);
  char one = 0;
  while (buf.size() < 4 || std::string(buf.data(), buf.size()).find("\r\n\r\n") == std::string::npos) {
    if (buf.size() >= kHttpConnectReadLimit) {
      error = "netproxy: http CONNECT response too large";
      CloseSock(out);
      out = kInvalidSock;
      return false;
    }
    if (!RecvExact(out, &one, 1)) {
      error = "netproxy: http CONNECT closed by proxy";
      CloseSock(out);
      out = kInvalidSock;
      return false;
    }
    buf.push_back(one);
  }
  const std::string head(buf.data(), buf.size());
  const size_t sp1 = head.find(' ');
  const size_t sp2 = sp1 == std::string::npos ? std::string::npos : head.find(' ', sp1 + 1);
  const std::string code =
      (sp1 != std::string::npos && sp2 != std::string::npos) ? head.substr(sp1 + 1, sp2 - sp1 - 1) : "";
  if (code != "200") {
    const size_t eol = head.find("\r\n");
    error = "netproxy: http CONNECT failed: " + (eol == std::string::npos ? head : head.substr(0, eol));
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  return true;
}

bool ResolveSocks4Ipv4(const std::string& host, uint16_t port, std::array<unsigned char, 4>& out, std::string& error) {
  in_addr parsed{};
  if (inet_pton(AF_INET, host.c_str(), &parsed) == 1) {
    const uint32_t n = ntohl(parsed.s_addr);
    out = {static_cast<unsigned char>((n >> 24) & 0xff), static_cast<unsigned char>((n >> 16) & 0xff),
           static_cast<unsigned char>((n >> 8) & 0xff), static_cast<unsigned char>(n & 0xff)};
    return true;
  }
  addrinfo hints{};
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo* res = nullptr;
  const std::string port_text = std::to_string(port);
  if (getaddrinfo(host.c_str(), port_text.c_str(), &hints, &res) != 0 || res == nullptr) {
    error = "netproxy: SOCKS4 requires an IPv4 target; use SOCKS4a for remote DNS";
    return false;
  }
  auto* v4 = reinterpret_cast<sockaddr_in*>(res->ai_addr);
  const uint32_t n = ntohl(v4->sin_addr.s_addr);
  out = {static_cast<unsigned char>((n >> 24) & 0xff), static_cast<unsigned char>((n >> 16) & 0xff),
         static_cast<unsigned char>((n >> 8) & 0xff), static_cast<unsigned char>(n & 0xff)};
  freeaddrinfo(res);
  return true;
}

bool DialSocks4(const Options& proxy, const std::string& host, uint16_t port, bool remote_dns, Sock& out,
                std::string& error) {
  out = ConnectTcp(proxy.host, static_cast<uint16_t>(proxy.PortOrDefault()), error);
  if (out == kInvalidSock) {
    return false;
  }
  std::vector<unsigned char> req;
  req.reserve(10 + proxy.username.size() + host.size());
  req.push_back(0x04);
  req.push_back(0x01);
  req.push_back(static_cast<unsigned char>((port >> 8) & 0xff));
  req.push_back(static_cast<unsigned char>(port & 0xff));
  if (remote_dns) {
    req.insert(req.end(), {0, 0, 0, 1});
  } else {
    std::array<unsigned char, 4> ip{};
    if (!ResolveSocks4Ipv4(host, port, ip, error)) {
      CloseSock(out);
      out = kInvalidSock;
      return false;
    }
    req.insert(req.end(), ip.begin(), ip.end());
  }
  req.insert(req.end(), proxy.username.begin(), proxy.username.end());
  req.push_back(0);
  if (remote_dns) {
    req.insert(req.end(), host.begin(), host.end());
    req.push_back(0);
  }
  if (!SendAll(out, req.data(), req.size())) {
    error = "netproxy: SOCKS4 write failed";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  unsigned char resp[8]{};
  if (!RecvExact(out, resp, 8) || resp[1] != 0x5a) {
    error = "netproxy: SOCKS4 connect failed";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  return true;
}

bool Socks5Auth(Sock fd, const std::string& user, const std::string& pass, std::string& error) {
  if (user.size() > 255 || pass.size() > 255) {
    error = "netproxy: SOCKS5 username or password is too long";
    return false;
  }
  std::vector<unsigned char> req;
  req.reserve(3 + user.size() + pass.size());
  req.push_back(0x01);
  req.push_back(static_cast<unsigned char>(user.size()));
  req.insert(req.end(), user.begin(), user.end());
  req.push_back(static_cast<unsigned char>(pass.size()));
  req.insert(req.end(), pass.begin(), pass.end());
  if (!SendAll(fd, req.data(), req.size())) {
    error = "netproxy: SOCKS5 auth write failed";
    return false;
  }
  unsigned char resp[2]{};
  if (!RecvExact(fd, resp, 2) || resp[0] != 0x01 || resp[1] != 0x00) {
    error = "netproxy: SOCKS5 username/password auth failed";
    return false;
  }
  return true;
}

bool ConsumeSocks5Bound(Sock fd, unsigned char atyp, std::string& error) {
  if (atyp == 0x01) {
    unsigned char rest[6]{};
    if (!RecvExact(fd, rest, 6)) {
      error = "netproxy: SOCKS5 bad bound addr";
      return false;
    }
    return true;
  }
  if (atyp == 0x03) {
    unsigned char len = 0;
    if (!RecvExact(fd, &len, 1)) {
      error = "netproxy: SOCKS5 bad bound addr";
      return false;
    }
    std::vector<unsigned char> rest(static_cast<size_t>(len) + 2);
    if (!RecvExact(fd, rest.data(), rest.size())) {
      error = "netproxy: SOCKS5 bad bound addr";
      return false;
    }
    return true;
  }
  if (atyp == 0x04) {
    unsigned char rest[18]{};
    if (!RecvExact(fd, rest, 18)) {
      error = "netproxy: SOCKS5 bad bound addr";
      return false;
    }
    return true;
  }
  error = "netproxy: unsupported SOCKS5 address type";
  return false;
}

bool DialSocks5(const Options& proxy, const std::string& host, uint16_t port, Sock& out, std::string& error) {
  out = ConnectTcp(proxy.host, static_cast<uint16_t>(proxy.PortOrDefault()), error);
  if (out == kInvalidSock) {
    return false;
  }
  if (proxy.username.empty()) {
    const unsigned char hello[] = {0x05, 0x01, 0x00};
    if (!SendAll(out, hello, sizeof(hello))) {
      error = "netproxy: SOCKS5 hello write failed";
      CloseSock(out);
      out = kInvalidSock;
      return false;
    }
  } else {
    const unsigned char hello[] = {0x05, 0x01, 0x02};
    if (!SendAll(out, hello, sizeof(hello))) {
      error = "netproxy: SOCKS5 hello write failed";
      CloseSock(out);
      out = kInvalidSock;
      return false;
    }
  }
  unsigned char method[2]{};
  if (!RecvExact(out, method, 2) || method[0] != 0x05) {
    error = "netproxy: invalid SOCKS5 version";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  if (method[1] == 0x02) {
    if (!Socks5Auth(out, proxy.username, proxy.password, error)) {
      CloseSock(out);
      out = kInvalidSock;
      return false;
    }
  } else if (method[1] == 0xff) {
    error = "netproxy: SOCKS5 proxy rejected auth methods";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  } else if (method[1] != 0x00) {
    error = "netproxy: unsupported SOCKS5 auth method";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  if (host.size() > 255) {
    error = "netproxy: SOCKS5 target host is too long";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  std::vector<unsigned char> req;
  req.reserve(7 + host.size());
  req.insert(req.end(), {0x05, 0x01, 0x00, 0x03, static_cast<unsigned char>(host.size())});
  req.insert(req.end(), host.begin(), host.end());
  req.push_back(static_cast<unsigned char>((port >> 8) & 0xff));
  req.push_back(static_cast<unsigned char>(port & 0xff));
  if (!SendAll(out, req.data(), req.size())) {
    error = "netproxy: SOCKS5 connect write failed";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  unsigned char head[4]{};
  if (!RecvExact(out, head, 4) || head[0] != 0x05) {
    error = "netproxy: invalid SOCKS5 response version";
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  if (head[1] != 0x00) {
    error = "netproxy: SOCKS5 connect failed: " + std::to_string(head[1]);
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  if (!ConsumeSocks5Bound(out, head[3], error)) {
    CloseSock(out);
    out = kInvalidSock;
    return false;
  }
  return true;
}

bool DialThroughProxy(const Options& proxy, const std::string& host, uint16_t port, Sock& out, std::string& error) {
  if (!proxy.Enabled()) {
    out = ConnectTcp(host, port, error);
    return out != kInvalidSock;
  }
  if (proxy.type == "http") {
    return DialHttp(proxy, host, port, out, error);
  }
  if (proxy.type == "socks4") {
    return DialSocks4(proxy, host, port, false, out, error);
  }
  if (proxy.type == "socks4a") {
    return DialSocks4(proxy, host, port, true, out, error);
  }
  if (proxy.type == "socks5") {
    return DialSocks5(proxy, host, port, out, error);
  }
  error = "netproxy: unsupported type " + proxy.type;
  return false;
}

void Pump(Sock a, Sock b) {
  char buf[16 * 1024];
  for (;;) {
#ifdef NIUMA_NETPROXY_WIN
    const int n = recv(a, buf, sizeof(buf), 0);
#else
    const ssize_t n = recv(a, buf, sizeof(buf), 0);
#endif
    if (n <= 0) {
      break;
    }
    if (!SendAll(b, buf, static_cast<size_t>(n))) {
      break;
    }
  }
#ifdef NIUMA_NETPROXY_WIN
  shutdown(a, SD_BOTH);
  shutdown(b, SD_BOTH);
#else
  shutdown(a, SHUT_RDWR);
  shutdown(b, SHUT_RDWR);
#endif
}

void Bridge(Sock local, Sock upstream) {
  std::thread t([local, upstream]() {
    Pump(local, upstream);
  });
  Pump(upstream, local);
  if (t.joinable()) {
    t.join();
  }
  CloseSock(local);
  CloseSock(upstream);
}

}  // namespace

bool Options::Enabled() const {
  if (type.empty() || type == "none") {
    return false;
  }
  return !host.empty();
}

int Options::PortOrDefault() const {
  if (port > 0) {
    return port;
  }
  return type == "http" ? 8080 : 1080;
}

RelayGuard::~RelayGuard() { Stop(); }

void RelayGuard::Stop() {
  stop_.store(true);
#ifdef NIUMA_NETPROXY_WIN
  if (listen_fd_ != static_cast<uintptr_t>(INVALID_SOCKET)) {
    closesocket(static_cast<SOCKET>(listen_fd_));
    listen_fd_ = static_cast<uintptr_t>(INVALID_SOCKET);
  }
#else
  if (listen_fd_ >= 0) {
    close(listen_fd_);
    listen_fd_ = -1;
  }
#endif
  if (accept_thread_.joinable()) {
    accept_thread_.join();
  }
}

std::unique_ptr<RelayGuard> StartRelay(const Options& proxy, const std::string& target_host, uint16_t target_port,
                                       std::string& local_host, uint16_t& local_port, std::string& error) {
  if (!EnsureWinsock(error)) {
    return nullptr;
  }
  if (!proxy.Enabled()) {
    error = "netproxy: proxy not enabled";
    return nullptr;
  }

  Sock listen_fd = static_cast<Sock>(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
  if (listen_fd == kInvalidSock) {
    error = LastSockError("netproxy: listen socket");
    return nullptr;
  }
  SetCloexec(listen_fd);
  int yes = 1;
#ifdef NIUMA_NETPROXY_WIN
  setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&yes), sizeof(yes));
#else
  setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
#endif

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = htons(0);
  if (bind(listen_fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    error = LastSockError("netproxy: bind");
    CloseSock(listen_fd);
    return nullptr;
  }
  if (listen(listen_fd, 16) != 0) {
    error = LastSockError("netproxy: listen");
    CloseSock(listen_fd);
    return nullptr;
  }
  sockaddr_in bound{};
  socklen_t bound_len = sizeof(bound);
  if (getsockname(listen_fd, reinterpret_cast<sockaddr*>(&bound), &bound_len) != 0) {
    error = LastSockError("netproxy: getsockname");
    CloseSock(listen_fd);
    return nullptr;
  }

  auto guard = std::make_unique<RelayGuard>();
#ifdef NIUMA_NETPROXY_WIN
  guard->listen_fd_ = static_cast<uintptr_t>(listen_fd);
#else
  guard->listen_fd_ = listen_fd;
#endif
  local_host = "127.0.0.1";
  local_port = ntohs(bound.sin_port);

  Options proxy_copy = proxy;
  std::string target = target_host;
  guard->accept_thread_ = std::thread([listen_fd, proxy_copy, target, target_port, stop = &guard->stop_]() {
    while (!stop->load()) {
      sockaddr_in peer{};
      socklen_t peer_len = sizeof(peer);
      Sock local = accept(listen_fd, reinterpret_cast<sockaddr*>(&peer), &peer_len);
      if (local == kInvalidSock) {
        break;
      }
      if (stop->load()) {
        CloseSock(local);
        break;
      }
      SetCloexec(local);
      std::thread([local, proxy_copy, target, target_port]() {
        std::string dial_err;
        Sock upstream = kInvalidSock;
        if (!DialThroughProxy(proxy_copy, target, target_port, upstream, dial_err)) {
          CloseSock(local);
          return;
        }
        Bridge(local, upstream);
      }).detach();
    }
  });

  return guard;
}

bool Dial(const Options& proxy, const std::string& host, uint16_t port, intptr_t& out_fd, std::string& error) {
  if (!EnsureWinsock(error)) {
    return false;
  }
  Sock sock = kInvalidSock;
  if (!DialThroughProxy(proxy, host, port, sock, error)) {
    return false;
  }
  out_fd = static_cast<intptr_t>(sock);
  return true;
}

}  // namespace niuma::netproxy
