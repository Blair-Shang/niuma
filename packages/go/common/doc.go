// Package common 是能力服务共用工具的模块根。
//
// 新能力一律放入子包，勿在根包继续堆积 API：
//
//   - id：进程内唯一 ID（UniqueID / CoalesceID）
//   - sqlcell：查询结果单元格字节编码启发式（文本 vs $binary）
package common
