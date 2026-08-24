#include <niuma/sshtunnel/sshtunnel.hpp>

#include <libssh2.h>

#include <cctype>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <sstream>

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
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
using Sock = int;
constexpr Sock kInvalidSock = -1;
#endif

namespace niuma::sshtunnel {
namespace {

std::once_flag g_libssh2_once;
std::mutex g_session_global_mu;  // libssh2 初始化串行化

void EnsureLibssh2() {
  std::call_once(g_libssh2_once, [] { libssh2_init(0); });
}

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

std::string ToLower(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

std::string Trim(std::string s) {
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) {
    s.erase(s.begin());
  }
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) {
    s.pop_back();
  }
  return s;
}

bool SameTunnelHost(const std::string& target, const std::string& jump) {
  const std::string a = ToLower(Trim(target));
  const std::string b = ToLower(Trim(jump));
  if (a.empty() || b.empty()) {
    return false;
  }
  return a == b;
}

std::string ExpandHome(const std::string& path) {
  const std::string trimmed = Trim(path);
  if (trimmed == "~") {
#ifdef NIUMA_NETPROXY_WIN
    if (const char* home = std::getenv("USERPROFILE")) {
      return home;
    }
#endif
    if (const char* home = std::getenv("HOME")) {
      return home;
    }
    return trimmed;
  }
  if (trimmed.size() >= 2 && trimmed[0] == '~' && (trimmed[1] == '/' || trimmed[1] == '\\')) {
#ifdef NIUMA_NETPROXY_WIN
    if (const char* home = std::getenv("USERPROFILE")) {
      return std::string(home) + trimmed.substr(1);
    }
#endif
    if (const char* home = std::getenv("HOME")) {
      return std::string(home) + trimmed.substr(1);
    }
  }
  return trimmed;
}

std::string SessionError(LIBSSH2_SESSION* session, const char* prefix) {
  char* msg = nullptr;
  const int code = libssh2_session_last_error(session, &msg, nullptr, 0);
  std::ostringstream oss;
  oss << prefix << ": [" << code << "]";
  if (msg && msg[0]) {
    oss << " " << msg;
  }
  return oss.str();
}

struct SSHSession {
  Sock sock = kInvalidSock;
  LIBSSH2_SESSION* session = nullptr;
  std::mutex mu;

  ~SSHSession() { Close(); }

  void Close() {
    std::lock_guard lock(mu);
    if (session) {
      libssh2_session_disconnect(session, "niuma sshtunnel stop");
      libssh2_session_free(session);
      session = nullptr;
    }
    CloseSock(sock);
    sock = kInvalidSock;
  }
};

bool Authenticate(LIBSSH2_SESSION* session, const SSHProfile& profile, std::string& error) {
  const std::string user = profile.login_account;
  std::string auth = ToLower(Trim(profile.auth_type));
  if (auth.empty()) {
    auth = "password";
  }

  if (auth == "password") {
    const int rc = libssh2_userauth_password(session, user.c_str(), profile.secret.c_str());
    if (rc != 0) {
      error = SessionError(session, "sshtunnel: password auth failed");
      return false;
    }
    return true;
  }

  if (auth == "private_key") {
    if (Trim(profile.secret).empty()) {
      error = "sshtunnel: private key content required";
      return false;
    }
    const char* pass = profile.passphrase.empty() ? nullptr : profile.passphrase.c_str();
    const int rc = libssh2_userauth_publickey_frommemory(
        session, user.c_str(), user.size(), nullptr, 0, profile.secret.c_str(), profile.secret.size(), pass);
    if (rc != 0) {
      error = SessionError(session, "sshtunnel: private key auth failed");
      return false;
    }
    return true;
  }

  if (auth == "private_key_file") {
    if (Trim(profile.private_key_path).empty()) {
      error = "sshtunnel: private_key_path required";
      return false;
    }
    const std::string path = ExpandHome(profile.private_key_path);
    const char* pass = profile.passphrase.empty() ? nullptr : profile.passphrase.c_str();
    const int rc = libssh2_userauth_publickey_fromfile(session, user.c_str(), nullptr, path.c_str(), pass);
    if (rc != 0) {
      error = SessionError(session, "sshtunnel: private key file auth failed");
      return false;
    }
    return true;
  }

  error = "sshtunnel: unsupported auth_type: " + profile.auth_type;
  return false;
}

std::shared_ptr<SSHSession> DialSSHJump(const SSHProfile& profile, std::string& error) {
  EnsureLibssh2();
  if (Trim(profile.host_address).empty()) {
    error = "sshtunnel: ssh profile host required";
    return nullptr;
  }

  const uint16_t jump_port =
      static_cast<uint16_t>(profile.port_number > 0 ? profile.port_number : 22);
  intptr_t fd = 0;
  if (!niuma::netproxy::Dial(profile.proxy, profile.host_address, jump_port, fd, error)) {
    if (error.empty()) {
      error = "sshtunnel: dial jump host failed";
    } else {
      error = "sshtunnel: " + error;
    }
    return nullptr;
  }

  auto out = std::make_shared<SSHSession>();
  out->sock = static_cast<Sock>(fd);

  {
    std::lock_guard global(g_session_global_mu);
    out->session = libssh2_session_init();
  }
  if (!out->session) {
    error = "sshtunnel: libssh2_session_init failed";
    return nullptr;
  }
  libssh2_session_set_blocking(out->session, 1);
  if (profile.timeout_seconds > 0) {
    libssh2_session_set_timeout(out->session, profile.timeout_seconds * 1000);
  } else {
    libssh2_session_set_timeout(out->session, 30 * 1000);
  }

  if (libssh2_session_handshake(out->session, out->sock) != 0) {
    error = SessionError(out->session, "sshtunnel: ssh handshake failed");
    return nullptr;
  }
  if (!Authenticate(out->session, profile, error)) {
    return nullptr;
  }
  return out;
}

bool ProbeRemote(const std::shared_ptr<SSHSession>& ssh, const std::string& host, uint16_t port,
                 std::string& error) {
  std::lock_guard lock(ssh->mu);
  LIBSSH2_CHANNEL* ch =
      libssh2_channel_direct_tcpip_ex(ssh->session, host.c_str(), port, "127.0.0.1", 0);
  if (!ch) {
    const std::string prefix =
        "sshtunnel: cannot reach " + host + ":" + std::to_string(port) + " via jump host";
    error = SessionError(ssh->session, prefix.c_str());
    return false;
  }
  libssh2_channel_close(ch);
  libssh2_channel_free(ch);
  return true;
}

void BridgeLocalToChannel(Sock local, LIBSSH2_CHANNEL* channel, SSHSession* ssh,
                          const std::atomic<bool>* stop) {
  char buf[16 * 1024];
  while (!stop->load()) {
    fd_set read_set;
    FD_ZERO(&read_set);
    FD_SET(local, &read_set);

#ifdef NIUMA_NETPROXY_WIN
    const int nfds = 0;
#else
    const int nfds = static_cast<int>(local) + 1;
#endif
    timeval tv{};
    tv.tv_sec = 0;
    tv.tv_usec = 200 * 1000;
    const int sel = select(nfds, &read_set, nullptr, nullptr, &tv);

    if (sel > 0 && FD_ISSET(local, &read_set)) {
#ifdef NIUMA_NETPROXY_WIN
      const int n = recv(local, buf, sizeof(buf), 0);
#else
      const ssize_t n = recv(local, buf, sizeof(buf), 0);
#endif
      if (n <= 0) {
        break;
      }
      size_t sent = 0;
      while (sent < static_cast<size_t>(n) && !stop->load()) {
        std::lock_guard lock(ssh->mu);
        const ssize_t w = libssh2_channel_write(channel, buf + sent, static_cast<size_t>(n) - sent);
        if (w == LIBSSH2_ERROR_EAGAIN) {
          continue;
        }
        if (w < 0) {
          goto done;
        }
        sent += static_cast<size_t>(w);
      }
    }

    {
      std::lock_guard lock(ssh->mu);
      const ssize_t n = libssh2_channel_read(channel, buf, sizeof(buf));
      if (n == LIBSSH2_ERROR_EAGAIN) {
        // no data
      } else if (n < 0) {
        break;
      } else if (n == 0) {
        if (libssh2_channel_eof(channel)) {
          break;
        }
      } else {
#ifdef NIUMA_NETPROXY_WIN
        const int w = send(local, buf, static_cast<int>(n), 0);
#else
        const ssize_t w = send(local, buf, static_cast<size_t>(n), 0);
#endif
        if (w <= 0) {
          break;
        }
      }
    }
  }
done:
  {
    std::lock_guard lock(ssh->mu);
    libssh2_channel_send_eof(channel);
    libssh2_channel_close(channel);
    libssh2_channel_free(channel);
  }
#ifdef NIUMA_NETPROXY_WIN
  shutdown(local, SD_BOTH);
#else
  shutdown(local, SHUT_RDWR);
#endif
  CloseSock(local);
}

void ForwardConn(const std::shared_ptr<SSHSession>& ssh, Sock local, std::string host, uint16_t port,
                 const std::atomic<bool>* stop) {
  LIBSSH2_CHANNEL* channel = nullptr;
  {
    std::lock_guard lock(ssh->mu);
    if (stop->load() || !ssh->session) {
      CloseSock(local);
      return;
    }
    channel = libssh2_channel_direct_tcpip_ex(ssh->session, host.c_str(), port, "127.0.0.1", 0);
    if (!channel) {
      CloseSock(local);
      return;
    }
  }
  BridgeLocalToChannel(local, channel, ssh.get(), stop);
}

}  // namespace

struct TunnelGuard::Impl {
  std::atomic<bool> stop{false};
#ifdef NIUMA_NETPROXY_WIN
  uintptr_t listen_fd = ~static_cast<uintptr_t>(0);
#else
  int listen_fd = -1;
#endif
  std::thread accept_thread;
  std::shared_ptr<SSHSession> ssh;
};

bool Options::Enabled() const {
  return type == "ssh";
}

TunnelGuard::~TunnelGuard() { Stop(); }

void TunnelGuard::Stop() {
  if (!impl_) {
    return;
  }
  impl_->stop.store(true);
#ifdef NIUMA_NETPROXY_WIN
  if (impl_->listen_fd != static_cast<uintptr_t>(INVALID_SOCKET)) {
    closesocket(static_cast<SOCKET>(impl_->listen_fd));
    impl_->listen_fd = static_cast<uintptr_t>(INVALID_SOCKET);
  }
#else
  if (impl_->listen_fd >= 0) {
    close(impl_->listen_fd);
    impl_->listen_fd = -1;
  }
#endif
  if (impl_->accept_thread.joinable()) {
    impl_->accept_thread.join();
  }
  if (impl_->ssh) {
    impl_->ssh->Close();
    impl_->ssh.reset();
  }
  impl_.reset();
}

std::unique_ptr<TunnelGuard> StartSSHTunnel(const Options& opts, const std::string& default_target_host,
                                            uint16_t default_target_port, std::string& local_host,
                                            uint16_t& local_port, std::string& error) {
  if (!opts.Enabled()) {
    error = "sshtunnel: tunnel not enabled";
    return nullptr;
  }
  if (!opts.has_ssh_profile) {
    error = "sshtunnel: ssh profile was not injected";
    return nullptr;
  }

  std::string target_host = Trim(opts.target_host.empty() ? default_target_host : opts.target_host);
  uint16_t target_port =
      opts.target_port > 0 ? static_cast<uint16_t>(opts.target_port) : default_target_port;
  if (SameTunnelHost(target_host, opts.ssh_profile.host_address)) {
    target_host = "127.0.0.1";
  }
  if (target_host.empty() || target_port == 0) {
    error = "sshtunnel: target host/port required";
    return nullptr;
  }

  auto ssh = DialSSHJump(opts.ssh_profile, error);
  if (!ssh) {
    return nullptr;
  }
  if (!ProbeRemote(ssh, target_host, target_port, error)) {
    return nullptr;
  }

  Sock listen_fd = static_cast<Sock>(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
  if (listen_fd == kInvalidSock) {
    error = LastSockError("sshtunnel: listen socket");
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
    error = LastSockError("sshtunnel: bind");
    CloseSock(listen_fd);
    return nullptr;
  }
  if (listen(listen_fd, 16) != 0) {
    error = LastSockError("sshtunnel: listen");
    CloseSock(listen_fd);
    return nullptr;
  }
  sockaddr_in bound{};
  socklen_t bound_len = sizeof(bound);
  if (getsockname(listen_fd, reinterpret_cast<sockaddr*>(&bound), &bound_len) != 0) {
    error = LastSockError("sshtunnel: getsockname");
    CloseSock(listen_fd);
    return nullptr;
  }

  auto guard = std::make_unique<TunnelGuard>();
  guard->impl_ = std::make_unique<TunnelGuard::Impl>();
#ifdef NIUMA_NETPROXY_WIN
  guard->impl_->listen_fd = static_cast<uintptr_t>(listen_fd);
#else
  guard->impl_->listen_fd = listen_fd;
#endif
  guard->impl_->ssh = ssh;
  local_host = "127.0.0.1";
  local_port = ntohs(bound.sin_port);

  auto* stop = &guard->impl_->stop;
  guard->impl_->accept_thread = std::thread([listen_fd, ssh, target_host, target_port, stop]() {
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
      std::thread([ssh, local, target_host, target_port, stop]() {
        ForwardConn(ssh, local, target_host, target_port, stop);
      }).detach();
    }
  });

  return guard;
}

}  // namespace niuma::sshtunnel
