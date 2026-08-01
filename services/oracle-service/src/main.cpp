#include "handler/dispatcher.hpp"
#include "util/paths.hpp"

#include <niuma/serviceipc/server.hpp>

#include <csignal>
#include <iostream>
#include <memory>

namespace {
std::unique_ptr<niuma::serviceipc::Server> g_server;

void OnSignal(int) {
  if (g_server) {
    g_server->Stop();
  }
}
}  // namespace

int main(int argc, char** argv) {
  std::string addr = niuma::oracle::util::DefaultIpcAddress();
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if ((a == "--addr" || a == "-a") && i + 1 < argc) {
      addr = argv[++i];
    }
  }

  std::cerr << "niuma-oracle-service starting\n"
            << "  ipc=" << addr << "\n"
            << "  oracleClientLibDir=" << niuma::oracle::util::OracleClientLibDir() << "\n";

  niuma::oracle::handler::Dispatcher dispatcher;
  g_server = std::make_unique<niuma::serviceipc::Server>(
      addr, [&dispatcher](const std::string& req) { return dispatcher.HandleFrame(req); },
      "oracle-service");

  std::signal(SIGINT, OnSignal);
  std::signal(SIGTERM, OnSignal);

  return g_server->Serve();
}
