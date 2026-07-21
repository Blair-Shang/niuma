package session

// pipelineCommand 描述一条聚合管道补全项。
type pipelineCommand struct {
	Name        string
	Description string
	Body        string
}

var pipelineStages = []pipelineCommand{
	{Name: "$addFields", Description: "添加或重写计算字段", Body: "{\n  \"$addFields\": {\n    \"${1:newField}\": \"$${2:sourceField}\"\n  }\n}"},
	{Name: "$bucket", Description: "按边界将文档分桶"},
	{Name: "$bucketAuto", Description: "自动将文档均匀分桶"},
	{Name: "$count", Description: "统计传入文档数", Body: "{\n  \"$count\": \"${1:count}\"\n}"},
	{Name: "$densify", Description: "补齐时序数据中的缺失值"},
	{Name: "$facet", Description: "在单个阶段内执行多条子管道", Body: "{\n  \"$facet\": {\n    \"${1:result}\": [\n      { \"$match\": {} }\n    ]\n  }\n}"},
	{Name: "$fill", Description: "填充 null 或缺失字段"},
	{Name: "$geoNear", Description: "按地理位置距离返回文档"},
	{Name: "$graphLookup", Description: "递归遍历图关系"},
	{Name: "$group", Description: "按表达式分组并执行聚合", Body: "{\n  \"$group\": {\n    \"_id\": \"$${1:field}\",\n    \"${2:count}\": { \"$sum\": 1 }\n  }\n}"},
	{Name: "$limit", Description: "限制传递给下一阶段的文档数", Body: "{\n  \"$limit\": ${1:20}\n}"},
	{Name: "$lookup", Description: "关联另一个集合", Body: "{\n  \"$lookup\": {\n    \"from\": \"${1:collection}\",\n    \"localField\": \"${2:localField}\",\n    \"foreignField\": \"${3:foreignField}\",\n    \"as\": \"${4:joined}\"\n  }\n}"},
	{Name: "$match", Description: "筛选文档，通常应尽量放在管道前部", Body: "{\n  \"$match\": {\n    \"${1:field}\": \"${2:value}\"\n  }\n}"},
	{Name: "$merge", Description: "将结果合并写入集合"},
	{Name: "$out", Description: "将结果写入并替换目标集合"},
	{Name: "$project", Description: "选择、排除或计算输出字段", Body: "{\n  \"$project\": {\n    \"${1:field}\": 1\n  }\n}"},
	{Name: "$redact", Description: "基于表达式限制文档内容"},
	{Name: "$replaceRoot", Description: "使用指定文档替换根文档"},
	{Name: "$replaceWith", Description: "使用表达式结果替换根文档"},
	{Name: "$sample", Description: "随机选择指定数量的文档", Body: "{\n  \"$sample\": { \"size\": ${1:10} }\n}"},
	{Name: "$set", Description: "添加或重写字段", Body: "{\n  \"$set\": {\n    \"${1:field}\": \"$${2:sourceField}\"\n  }\n}"},
	{Name: "$setWindowFields", Description: "计算窗口函数字段"},
	{Name: "$skip", Description: "跳过指定数量的文档", Body: "{\n  \"$skip\": ${1:0}\n}"},
	{Name: "$sort", Description: "按一个或多个字段排序", Body: "{\n  \"$sort\": {\n    \"${1:field}\": ${2|-1,1}\n  }\n}"},
	{Name: "$sortByCount", Description: "按表达式分组并按计数排序"},
	{Name: "$unionWith", Description: "合并另一个集合或子管道的结果"},
	{Name: "$unset", Description: "移除一个或多个字段", Body: "{\n  \"$unset\": \"${1:field}\"\n}"},
	{Name: "$unwind", Description: "展开数组字段", Body: "{\n  \"$unwind\": \"$${1:arrayField}\"\n}"},
	{Name: "$vectorSearch", Description: "执行 Atlas Vector Search 向量检索"},
}

var queryOperators = []pipelineCommand{
	{Name: "$and", Description: "所有查询条件均为真"},
	{Name: "$or", Description: "任一查询条件为真"},
	{Name: "$nor", Description: "所有查询条件均不为真"},
	{Name: "$not", Description: "反转查询条件"},
	{Name: "$expr", Description: "在查询中使用聚合表达式"},
	{Name: "$eq", Description: "等于指定值"},
	{Name: "$ne", Description: "不等于指定值"},
	{Name: "$gt", Description: "大于指定值"},
	{Name: "$gte", Description: "大于或等于指定值"},
	{Name: "$lt", Description: "小于指定值"},
	{Name: "$lte", Description: "小于或等于指定值"},
	{Name: "$in", Description: "值包含在指定数组中", Body: "\"$in\": [${1:value}]"},
	{Name: "$nin", Description: "值不包含在指定数组中", Body: "\"$nin\": [${1:value}]"},
	{Name: "$exists", Description: "字段是否存在", Body: "\"$exists\": ${1|true,false|}"},
	{Name: "$type", Description: "字段具有指定 BSON 类型"},
	{Name: "$regex", Description: "按正则表达式匹配"},
	{Name: "$elemMatch", Description: "至少一个数组元素满足全部条件"},
	{Name: "$size", Description: "数组长度等于指定值"},
}

var accumulators = []pipelineCommand{
	{Name: "$sum", Description: "返回数值总和或文档计数", Body: "\"$sum\": ${1:1}"},
	{Name: "$avg", Description: "返回数值平均值"},
	{Name: "$min", Description: "返回最小值"},
	{Name: "$max", Description: "返回最大值"},
	{Name: "$push", Description: "返回分组内全部值数组"},
	{Name: "$addToSet", Description: "返回分组内唯一值数组"},
	{Name: "$first", Description: "返回分组首个值"},
	{Name: "$last", Description: "返回分组最后一个值"},
	{Name: "$count", Description: "返回分组中文档数量"},
}

var expressionOperators = []pipelineCommand{
	{Name: "$add", Description: "将数字相加或日期加毫秒"},
	{Name: "$subtract", Description: "数字相减或日期求差"},
	{Name: "$multiply", Description: "将数字相乘"},
	{Name: "$divide", Description: "两数相除"},
	{Name: "$concat", Description: "连接字符串"},
	{Name: "$cond", Description: "条件表达式"},
	{Name: "$ifNull", Description: "null 或缺失时返回备用值"},
	{Name: "$eq", Description: "比较是否相等"},
	{Name: "$ne", Description: "比较是否不相等"},
	{Name: "$gt", Description: "比较是否大于"},
	{Name: "$gte", Description: "比较是否大于等于"},
	{Name: "$lt", Description: "比较是否小于"},
	{Name: "$lte", Description: "比较是否小于等于"},
	{Name: "$toString", Description: "转换为字符串"},
	{Name: "$toInt", Description: "转换为 int"},
	{Name: "$toDouble", Description: "转换为 double"},
	{Name: "$toDate", Description: "转换为日期"},
	{Name: "$size", Description: "返回数组长度"},
	{Name: "$map", Description: "映射数组元素"},
	{Name: "$filter", Description: "筛选数组元素"},
}

var lookupProperties = []pipelineCommand{
	{Name: "from", Description: "要关联的同库集合名", Body: "\"from\": \"${1:collection}\""},
	{Name: "localField", Description: "当前集合中的关联字段", Body: "\"localField\": \"${1:field}\""},
	{Name: "foreignField", Description: "目标集合中的关联字段", Body: "\"foreignField\": \"${1:field}\""},
	{Name: "let", Description: "传递给关联子管道的变量", Body: "\"let\": {\n  \"${1:name}\": \"$${2:field}\"\n}"},
	{Name: "pipeline", Description: "在目标集合上执行的子管道", Body: "\"pipeline\": [\n  ${1}\n]"},
	{Name: "as", Description: "保存关联结果的输出数组字段", Body: "\"as\": \"${1:joined}\""},
}

var unwindProperties = []pipelineCommand{
	{Name: "path", Description: "要展开的数组字段路径", Body: "\"path\": \"$${1:arrayField}\""},
	{Name: "includeArrayIndex", Description: "保存数组下标的输出字段", Body: "\"includeArrayIndex\": \"${1:index}\""},
	{Name: "preserveNullAndEmptyArrays", Description: "是否保留 null、缺失或空数组", Body: "\"preserveNullAndEmptyArrays\": ${1|true,false|}"},
}

var systemVariables = []pipelineCommand{
	{Name: "$$NOW", Description: "当前日期时间，在整条管道中保持不变"},
	{Name: "$$ROOT", Description: "当前阶段的根文档"},
	{Name: "$$CURRENT", Description: "当前字段路径的起始文档"},
	{Name: "$$REMOVE", Description: "在 $project/$set 中移除字段"},
}
