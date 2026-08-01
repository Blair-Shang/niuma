#pragma once

#include <string>

namespace niuma::oracle::util {

// 将标识符包成 Oracle 双引号形式，内部 " 转义为 ""。
// 空串返回空；调用方勿对空结果拼进 SQL。
std::string QuoteIdent(const std::string& ident);

// 校验 schema/对象名：仅允许字母数字、下划线、$、#（Oracle 常规命名）。
// 含其它字符时仍可用 QuoteIdent 安全引用，但树过滤应拒绝控制字符。
bool IsSafeIdent(const std::string& ident);

}  // namespace niuma::oracle::util
