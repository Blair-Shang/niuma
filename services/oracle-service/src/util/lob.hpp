#pragma once

#include <dpi.h>
#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::util {

constexpr uint64_t kLobPreviewMax = 4096;
constexpr uint64_t kLobFullMax = 4ull * 1024 * 1024;

struct LobReadResult {
  std::string data;
  uint64_t total_size = 0;
  bool truncated = false;
  bool is_binary = false;  // BLOB / RAW
};

// 从 dpiData LOB/BYTES 读取；max_bytes=0 表示预览上限 kLobPreviewMax。
bool ReadLobData(dpiContext* ctx, dpiNativeTypeNum native, dpiData* data, uint64_t max_bytes,
                 LobReadResult& out, std::string& error);

// 完整读取 CLOB/BLOB（含编码字节容量）；用于 DBMS_METADATA.GET_DDL 等大 LOB。
bool ReadCompleteLob(dpiConn* conn, dpiContext* ctx, dpiOracleTypeNum oracle_type,
                     dpiNativeTypeNum native, dpiData* data, uint64_t max_bytes,
                     std::string& value, std::string& error);

// 查询结果单元格：CLOB→预览字符串或 $lob；BLOB→$lob/$bin。
nlohmann::json LobCellToJson(dpiContext* ctx, dpiOracleTypeNum oracle_type, dpiNativeTypeNum native,
                             dpiData* data);

std::string Base64Encode(const std::string& raw);

}  // namespace niuma::oracle::util
