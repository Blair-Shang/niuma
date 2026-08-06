#pragma once

// 操作日志：仅元数据，禁止写入 SQL 正文 / 密码 / Wallet 密钥（对齐 Go logOp*）。

#include <niuma/logutil/logutil.hpp>

#include <initializer_list>
#include <string>
#include <string_view>
#include <vector>

namespace niuma::oracle::handler {

inline void LogOpInfo(std::string_view method, std::initializer_list<niuma::logutil::Attr> attrs = {}) {
  std::vector<niuma::logutil::Attr> all;
  all.emplace_back("op", method);
  all.insert(all.end(), attrs.begin(), attrs.end());
  niuma::logutil::Info(method, all);
}

inline void LogOpWarn(std::string_view method, std::string_view err,
                      std::initializer_list<niuma::logutil::Attr> attrs = {}) {
  std::vector<niuma::logutil::Attr> all;
  all.emplace_back("op", method);
  all.emplace_back("err", err);
  all.insert(all.end(), attrs.begin(), attrs.end());
  niuma::logutil::Warn(method, all);
}

inline void LogOpError(std::string_view method, std::string_view err,
                       std::initializer_list<niuma::logutil::Attr> attrs = {}) {
  std::vector<niuma::logutil::Attr> all;
  all.emplace_back("op", method);
  all.emplace_back("err", err);
  all.insert(all.end(), attrs.begin(), attrs.end());
  niuma::logutil::Error(method, all);
}

}  // namespace niuma::oracle::handler
