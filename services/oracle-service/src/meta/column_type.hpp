#pragma once

#include <string>

namespace niuma::oracle::meta {

// ALL_TAB_COLUMNS → 可执行的完整类型（VARCHAR2(n)、NUMBER(p,s) 等）。
inline constexpr const char* kAllTabColumnsTypeExpr = R"SQL(
CASE
  WHEN INSTR(c.DATA_TYPE, '(') > 0 THEN
    c.DATA_TYPE ||
    CASE
      WHEN c.DATA_TYPE_MOD = 'WITH TIME ZONE' THEN ' WITH TIME ZONE'
      WHEN c.DATA_TYPE_MOD = 'WITH LOCAL TIME ZONE' THEN ' WITH LOCAL TIME ZONE'
      ELSE ''
    END
  WHEN c.DATA_TYPE IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR') THEN
    c.DATA_TYPE || '(' ||
    CASE WHEN NVL(c.CHAR_USED, 'B') = 'C' THEN TO_CHAR(c.CHAR_LENGTH) || ' CHAR'
         ELSE TO_CHAR(c.DATA_LENGTH) END || ')'
  WHEN c.DATA_TYPE = 'NUMBER' THEN
    CASE
      WHEN c.DATA_PRECISION IS NULL THEN 'NUMBER'
      WHEN NVL(c.DATA_SCALE, 0) = 0 THEN 'NUMBER(' || c.DATA_PRECISION || ')'
      ELSE 'NUMBER(' || c.DATA_PRECISION || ',' || c.DATA_SCALE || ')'
    END
  WHEN c.DATA_TYPE = 'FLOAT' AND c.DATA_PRECISION IS NOT NULL THEN
    'FLOAT(' || c.DATA_PRECISION || ')'
  WHEN c.DATA_TYPE = 'RAW' THEN
    'RAW(' || c.DATA_LENGTH || ')'
  WHEN c.DATA_TYPE = 'TIMESTAMP' THEN
    'TIMESTAMP(' || NVL(c.DATA_SCALE, 6) || ')' ||
    CASE
      WHEN c.DATA_TYPE_MOD = 'WITH TIME ZONE' THEN ' WITH TIME ZONE'
      WHEN c.DATA_TYPE_MOD = 'WITH LOCAL TIME ZONE' THEN ' WITH LOCAL TIME ZONE'
      ELSE ''
    END
  WHEN c.DATA_TYPE = 'INTERVAL YEAR TO MONTH' THEN
    'INTERVAL YEAR(' || NVL(c.DATA_PRECISION, 2) || ') TO MONTH'
  WHEN c.DATA_TYPE = 'INTERVAL DAY TO SECOND' THEN
    'INTERVAL DAY(' || NVL(c.DATA_PRECISION, 2) || ') TO SECOND(' || NVL(c.DATA_SCALE, 6) || ')'
  ELSE c.DATA_TYPE
END
)SQL";

std::string TrimOracleDefault(std::string value);

}  // namespace niuma::oracle::meta
