#include "dataio/atomic_output.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>

int main() {
  namespace fs = std::filesystem;
  using niuma::oracle::dataio::AtomicOutput;

  const fs::path target = fs::temp_directory_path() / "niuma-oracle-atomic-output-test.txt";
  {
    std::ofstream old(target, std::ios::binary | std::ios::trunc);
    old << "old";
  }
  std::string error;
  {
    AtomicOutput output(target.string());
    if (!output.Open(error)) {
      std::cerr << error << "\n";
      return 1;
    }
    output.stream() << "new";
    if (!output.Commit(error)) {
      std::cerr << error << "\n";
      return 1;
    }
  }
  std::ifstream input(target, std::ios::binary);
  std::ostringstream text;
  text << input.rdbuf();
  std::error_code ignored;
  fs::remove(target, ignored);
  if (text.str() != "new") {
    std::cerr << "atomic replacement failed\n";
    return 1;
  }
  std::cout << "ok\n";
  return 0;
}
