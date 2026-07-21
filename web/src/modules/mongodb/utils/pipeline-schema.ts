interface MongoCommandSpec {
  name: string
  description: string
  body?: string
}

function commandSpecs(rows: Array<[string, string, string?]>): MongoCommandSpec[] {
  return rows.map(([name, description, body]) => ({ name, description, body }))
}

/** MongoDB 聚合管道阶段（仅用于 JSON Schema 校验）。 */
const MONGO_PIPELINE_STAGES = commandSpecs([
  ['$addFields', '添加或重写计算字段'],
  ['$bucket', '按边界将文档分桶'],
  ['$bucketAuto', '自动将文档均匀分桶'],
  ['$changeStream', '监听集合变更事件'],
  ['$changeStreamSplitLargeEvent', '拆分过大的 Change Stream 事件'],
  ['$collStats', '返回集合或视图统计信息'],
  ['$count', '统计传入文档数'],
  ['$currentOp', '返回数据库当前操作'],
  ['$densify', '补齐时序数据中的缺失值'],
  ['$documents', '从字面量文档生成管道输入'],
  ['$facet', '在单个阶段内执行多条子管道'],
  ['$fill', '填充 null 或缺失字段'],
  ['$geoNear', '按地理位置距离返回文档'],
  ['$graphLookup', '递归遍历图关系'],
  ['$group', '按表达式分组并执行聚合'],
  ['$indexStats', '返回集合索引使用统计'],
  ['$limit', '限制传递给下一阶段的文档数'],
  ['$listLocalSessions', '列出当前 mongod/mongos 上的本地会话'],
  ['$listSampledQueries', '列出查询分析器采样的查询'],
  ['$listSearchIndexes', '列出 Atlas Search 索引'],
  ['$listSessions', '列出系统会话'],
  ['$lookup', '关联另一个集合'],
  ['$match', '筛选文档，通常应尽量放在管道前部'],
  ['$merge', '将结果合并写入集合'],
  ['$out', '将结果写入并替换目标集合'],
  ['$planCacheStats', '返回查询计划缓存统计'],
  ['$project', '选择、排除或计算输出字段'],
  ['$querySettings', '返回集群查询设置'],
  ['$rankFusion', '融合多条管道的排名结果'],
  ['$redact', '基于表达式限制文档内容'],
  ['$replaceRoot', '使用指定文档替换根文档'],
  ['$replaceWith', '使用表达式结果替换根文档'],
  ['$sample', '随机选择指定数量的文档'],
  ['$search', '执行 Atlas Search 查询'],
  ['$searchMeta', '返回 Atlas Search 元数据'],
  ['$set', '添加或重写字段'],
  ['$setWindowFields', '计算窗口函数字段'],
  ['$shardedDataDistribution', '返回分片集合的数据分布'],
  ['$skip', '跳过指定数量的文档'],
  ['$sort', '按一个或多个字段排序'],
  ['$sortByCount', '按表达式分组并按计数排序'],
  ['$unionWith', '合并另一个集合或子管道的结果'],
  ['$unset', '移除一个或多个字段'],
  ['$unwind', '展开数组字段'],
  ['$vectorSearch', '执行 Atlas Vector Search 向量检索'],
])

const SIMPLE_STAGE_SCHEMAS: Record<string, object> = {
  $count: { type: 'string', minLength: 1 },
  $limit: { type: 'integer', minimum: 0 },
  $skip: { type: 'integer', minimum: 0 },
  $sort: { type: 'object', additionalProperties: { enum: [1, -1, { $meta: 'textScore' }] } },
  $match: { type: 'object', additionalProperties: true },
  $project: { type: 'object', additionalProperties: true },
  $set: { type: 'object', additionalProperties: true },
  $addFields: { type: 'object', additionalProperties: true },
  $group: { type: 'object', required: ['_id'], additionalProperties: true },
  $lookup: {
    type: 'object',
    required: ['from', 'as'],
    properties: {
      from: { type: 'string' },
      localField: { type: 'string' },
      foreignField: { type: 'string' },
      let: { type: 'object' },
      pipeline: { type: 'array' },
      as: { type: 'string' },
    },
    additionalProperties: false,
  },
}

function stageProperties(): Record<string, object> {
  return Object.fromEntries(MONGO_PIPELINE_STAGES.map((stage) => [
    stage.name,
    SIMPLE_STAGE_SCHEMAS[stage.name] ?? {
      description: stage.description,
    },
  ]))
}

/** MongoDB 聚合管道 JSON Schema，用于 Monaco 结构诊断。补全候选由 `mongodb.pipeline.suggest` 提供。 */
export const mongoPipelineJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'MongoDB Aggregation Pipeline',
  type: 'array',
  items: {
    type: 'object',
    minProperties: 1,
    maxProperties: 1,
    additionalProperties: false,
    properties: stageProperties(),
  },
}
