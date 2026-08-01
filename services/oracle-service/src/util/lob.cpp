#include "util/lob.hpp"

namespace niuma::oracle::util {
namespace {

std::string DpiError(dpiContext* ctx) {
  dpiErrorInfo info{};
  if (ctx) {
    dpiContext_getError(ctx, &info);
  }
  if (info.message == nullptr) {
    return "oracle: lob error";
  }
  return std::string("oracle: ") + info.message;
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
  const uint64_t to_read = size > cap ? cap : size;
  out.data.resize(static_cast<size_t>(to_read));
  uint64_t amount = to_read;
  if (to_read > 0 && dpiLob_readBytes(lob, 1, to_read, out.data.data(), &amount) < 0) {
    error = DpiError(ctx);
    return false;
  }
  out.data.resize(static_cast<size_t>(amount));
  out.truncated = size > amount;
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
