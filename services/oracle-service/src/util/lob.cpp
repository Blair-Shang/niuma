#include "util/lob.hpp"

#include "util/dpi_error.hpp"

#include <limits>
#include <new>

namespace niuma::oracle::util {
namespace {

std::string DpiError(dpiContext* ctx) {
  return FormatDpiError(ctx, "oracle: lob error");
}

const char kB64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

}  // namespace

std::string Base64Encode(const std::string& raw) {
  std::string out;
  out.reserve(((raw.size() + 2) / 3) * 4);
  size_t i = 0;
  while (i + 3 <= raw.size()) {
    const unsigned char a = static_cast<unsigned char>(raw[i]);
    const unsigned char b = static_cast<unsigned char>(raw[i + 1]);
    const unsigned char c = static_cast<unsigned char>(raw[i + 2]);
    out.push_back(kB64[a >> 2]);
    out.push_back(kB64[((a & 3) << 4) | (b >> 4)]);
    out.push_back(kB64[((b & 15) << 2) | (c >> 6)]);
    out.push_back(kB64[c & 63]);
    i += 3;
  }
  if (i < raw.size()) {
    const unsigned char a = static_cast<unsigned char>(raw[i]);
    out.push_back(kB64[a >> 2]);
    if (i + 1 < raw.size()) {
      const unsigned char b = static_cast<unsigned char>(raw[i + 1]);
      out.push_back(kB64[((a & 3) << 4) | (b >> 4)]);
      out.push_back(kB64[(b & 15) << 2]);
      out.push_back('=');
    } else {
      out.push_back(kB64[(a & 3) << 4]);
      out.push_back('=');
      out.push_back('=');
    }
  }
  return out;
}

bool ReadLobData(dpiContext* ctx, dpiNativeTypeNum native, dpiData* data, uint64_t max_bytes,
                 LobReadResult& out, std::string& error) {
  out = {};
  if (data == nullptr || data->isNull) {
    return true;
  }
  const uint64_t cap = max_bytes == 0 ? kLobPreviewMax : max_bytes;
  if (native == DPI_NATIVE_TYPE_BYTES) {
    const uint32_t len = data->value.asBytes.length;
    out.total_size = len;
    const uint32_t n = len > cap ? static_cast<uint32_t>(cap) : len;
    out.data.assign(reinterpret_cast<const char*>(data->value.asBytes.ptr), n);
    out.truncated = len > n;
    return true;
  }
  if (native != DPI_NATIVE_TYPE_LOB) {
    error = "oracle: unsupported lob native type";
    return false;
  }
  dpiLob* lob = data->value.asLOB;
  uint64_t size = 0;
  if (dpiLob_getSize(lob, &size) < 0) {
    error = DpiError(ctx);
    return false;
  }
  out.total_size = size;
  // CLOB/NCLOB：amount 按「字符」计，但 valueLength/缓冲区必须按字节，且需预留
  // maxBytesPerCharacter（UTF-8 最多 4）。缓冲只开 size 字节时 OCI 会截断，
  // 短 CLOB 也会被错误打成 truncated+$lob。
  const uint64_t to_read = size > cap ? cap : size;
  constexpr uint64_t kMaxBytesPerChar = 4;
  if (to_read > std::numeric_limits<uint64_t>::max() / kMaxBytesPerChar) {
    error = "oracle: LOB size overflow";
    return false;
  }
  const uint64_t capacity = to_read * kMaxBytesPerChar;
  try {
    out.data.resize(static_cast<size_t>(capacity));
  } catch (const std::bad_alloc&) {
    error = "oracle: insufficient memory to read LOB";
    return false;
  }
  uint64_t value_length = capacity;
  if (to_read > 0 && dpiLob_readBytes(lob, 1, to_read, out.data.data(), &value_length) < 0) {
    error = DpiError(ctx);
    return false;
  }
  if (value_length > capacity) {
    error = "oracle: invalid LOB length returned by driver";
    return false;
  }
  out.data.resize(static_cast<size_t>(value_length));
  out.truncated = size > to_read;
  return true;
}

bool ReadCompleteLob(dpiConn* conn, dpiContext* ctx, dpiOracleTypeNum oracle_type,
                     dpiNativeTypeNum native, dpiData* data, uint64_t max_bytes, std::string& value,
                     std::string& error) {
  value.clear();
  if (!data || data->isNull) {
    return true;
  }
  if (native == DPI_NATIVE_TYPE_BYTES) {
    const uint64_t length = data->value.asBytes.length;
    if (length > max_bytes) {
      error = "oracle: LOB exceeds supported size";
      return false;
    }
    value.assign(reinterpret_cast<const char*>(data->value.asBytes.ptr), data->value.asBytes.length);
    return true;
  }
  if (native != DPI_NATIVE_TYPE_LOB || !data->value.asLOB) {
    error = "oracle: unsupported LOB native type";
    return false;
  }

  uint64_t units = 0;
  if (dpiLob_getSize(data->value.asLOB, &units) < 0) {
    error = DpiError(ctx);
    return false;
  }
  uint64_t bytes_per_unit = 1;
  if (oracle_type != DPI_ORACLE_TYPE_BLOB) {
    dpiEncodingInfo encoding{};
    if (!conn || dpiConn_getEncodingInfo(conn, &encoding) < 0) {
      error = DpiError(ctx);
      return false;
    }
    const int32_t width = oracle_type == DPI_ORACLE_TYPE_NCLOB ? encoding.nmaxBytesPerCharacter
                                                               : encoding.maxBytesPerCharacter;
    bytes_per_unit = width > 0 ? static_cast<uint64_t>(width) : 4;
  }
  if (units > std::numeric_limits<uint64_t>::max() / bytes_per_unit) {
    error = "oracle: LOB size overflow";
    return false;
  }
  if (max_bytes != std::numeric_limits<uint64_t>::max() && units > max_bytes) {
    error = "oracle: LOB exceeds supported size";
    return false;
  }
  const uint64_t capacity = units * bytes_per_unit;
  if (capacity > static_cast<uint64_t>(std::numeric_limits<size_t>::max())) {
    error = "oracle: LOB is too large for this process";
    return false;
  }
  try {
    value.resize(static_cast<size_t>(capacity));
  } catch (const std::bad_alloc&) {
    error = "oracle: insufficient memory to read LOB";
    return false;
  }
  uint64_t value_length = capacity;
  if (units > 0 && dpiLob_readBytes(data->value.asLOB, 1, units, value.data(), &value_length) < 0) {
    error = DpiError(ctx);
    return false;
  }
  if (value_length > capacity) {
    error = "oracle: invalid LOB length returned by driver";
    return false;
  }
  value.resize(static_cast<size_t>(value_length));
  if (value_length > max_bytes) {
    error = "oracle: LOB exceeds supported size";
    return false;
  }
  return true;
}

nlohmann::json LobCellToJson(dpiContext* ctx, dpiOracleTypeNum oracle_type, dpiNativeTypeNum native,
                             dpiData* data) {
  const bool binary = oracle_type == DPI_ORACLE_TYPE_BLOB || oracle_type == DPI_ORACLE_TYPE_RAW;
  LobReadResult lob;
  std::string err;
  if (!ReadLobData(ctx, native, data, kLobPreviewMax, lob, err)) {
    return nullptr;
  }
  lob.is_binary = binary;
  if (!lob.truncated && !binary) {
    return lob.data;
  }
  if (!lob.truncated && binary) {
    return nlohmann::json{{"$bin", Base64Encode(lob.data)}};
  }
  nlohmann::json j{
      {"$lob",
       {{"type", binary ? "BLOB" : "CLOB"},
        {"truncated", true},
        {"byteLength", lob.total_size},
        {"preview", binary ? Base64Encode(lob.data) : lob.data}}},
  };
  return j;
}

}  // namespace niuma::oracle::util
