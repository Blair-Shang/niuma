#pragma once

#include "niuma/sqllsp/types.hpp"

#include <string>
#include <vector>

namespace niuma::sqllsp {

/** 将 LSP Position 转为字节偏移（按 UTF-8 code point 近似；BMP 按 1，非 BMP 按 2 UTF-16 unit）。 */
int OffsetFromPosition(const std::string& text, Position pos);

/** 光标前标识符前缀（不含引号）。 */
std::string IdentPrefixAt(const std::string& text, int offset);

/** 当前语句表引用（FROM/JOIN/UPDATE/INTO，半成品友好）。 */
std::vector<TableRef> ExtractTableRefs(const std::string& text, int offset);

/** 将 x.（别名或表名）解析为真实 schema+table。 */
bool ResolveDotQualifier(const std::vector<TableRef>& refs, const std::string& name,
                         const std::string& default_db, std::string& schema, std::string& table);

/**
 * 通用 SQL 补全槽位启发式（对齐 Go sqllsp.HeuristicCompletionContext）。
 * 方言可在此基础上覆盖 Schema/Table 语义。
 */
CompletionContext HeuristicCompletionContext(const std::string& text, Position pos,
                                             const std::vector<std::string>& keywords);

}  // namespace niuma::sqllsp
