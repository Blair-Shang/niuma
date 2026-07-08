#include "util/plugin_scanner.h"

#include "util/json_util.h"
#include "util/plugin_registry.h"
#include "util/runtime_paths.h"

#include <filesystem>
#include <fstream>
#include <sstream>

namespace fs = std::filesystem;

namespace niuma {

namespace {

std::string JsonEscape(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char c : value) {
    switch (c) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        out.push_back(c);
        break;
    }
  }
  return out;
}

bool TryReadManifest(const fs::path& manifest_path,
                     const std::string& root_relative,
                     std::vector<LocalPluginRecord>& out) {
  if (!fs::exists(manifest_path) || !fs::is_regular_file(manifest_path)) {
    return false;
  }

  std::ifstream input(manifest_path, std::ios::binary);
  if (!input) {
    return false;
  }

  std::ostringstream buffer;
  buffer << input.rdbuf();
  const std::string content = buffer.str();
  if (content.empty()) {
    return false;
  }

  LocalPluginRecord record;
  record.root = root_relative;
  record.plugin_id = JsonGetString(content, "id");
  record.manifest_json = content;
  out.push_back(std::move(record));
  return true;
}

}  // namespace

std::vector<LocalPluginRecord> ScanLocalPluginManifests() {
  std::vector<LocalPluginRecord> records;
  const fs::path base = fs::u8path(GetPluginsPath());
  if (!fs::exists(base) || !fs::is_directory(base)) {
    return records;
  }

  const auto scan_one = [&](const fs::path& relative) {
    TryReadManifest(base / relative / "manifest.json", relative.generic_string(), records);
  };

  for (const auto& entry : fs::directory_iterator(base)) {
    if (!entry.is_directory()) {
      continue;
    }

    const std::string name = entry.path().filename().string();
    if (name.empty() || name[0] == '.') {
      continue;
    }

    if (name == "_examples") {
      for (const auto& example : fs::directory_iterator(entry.path())) {
        if (!example.is_directory()) {
          continue;
        }
        scan_one(fs::path("_examples") / example.path().filename());
      }
      continue;
    }

    scan_one(name);
  }

  return records;
}

std::string LocalPluginListJson(const std::vector<LocalPluginRecord>& records,
                                bool enabled_only) {
  std::ostringstream ss;
  ss << "{\"plugins\":[";
  bool first = true;
  for (const auto& record : records) {
    const bool enabled =
        !record.plugin_id.empty() && IsPluginEnabled(record.plugin_id);
    if (enabled_only && !enabled) {
      continue;
    }
    if (!first) {
      ss << ',';
    }
    first = false;
    ss << "{\"root\":\"" << JsonEscape(record.root) << "\",\"pluginId\":\""
       << JsonEscape(record.plugin_id) << "\",\"enabled\":" << (enabled ? "true" : "false")
       << ",\"manifest\":" << record.manifest_json << '}';
  }
  ss << "]}";
  return ss.str();
}

}  // namespace niuma
