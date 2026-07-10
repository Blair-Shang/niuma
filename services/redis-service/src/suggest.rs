//! Redis command metadata used for client-side auto-suggestion, in two flavors:
//!
//! - A bundled **static** table (`COMMANDS`), covering the most frequently used commands. It
//!   needs no I/O and no connected session, so `command.suggest` can be served instantly.
//! - An optional **dynamic** table (`DynCommand`/`DynSubcommand`), built at runtime from a live
//!   session's own `COMMAND DOCS` reply (see `session::commanddocs`). This mirrors what modern
//!   `redis-cli` does: prefer whatever the *actually connected* server reports (exact version,
//!   renamed/disabled commands, loaded modules) and only fall back to the static table when a
//!   session isn't available or the server doesn't support `COMMAND DOCS` (Redis < 7.0).
//!
//! Both flavors share one completion engine (`suggest_generic`) via the `CommandTable` /
//! `SubcommandTable` traits, so the parsing/matching logic is written and tested exactly once.
//!
//! Completion is two-level, mirroring how `redis-cli` treats "container" commands: once the
//! first token resolves to a command that has subcommands (e.g. `CONFIG`, `CLUSTER`, `CLIENT`),
//! the second token is matched against that command's own subcommand table. Beyond that, the
//! argument hint narrows as more arguments are typed (`remainingArguments` in the response),
//! instead of always showing the command's full static signature.

use serde_json::{json, Value};

/// Maximum number of suggestions returned for a single query, bounding response size.
const MAX_SUGGESTIONS: usize = 20;
/// Hard cap on the input length processed by `suggest`/`suggest_dynamic`; a terminal input box
/// has no legitimate reason to send multi-kilobyte "current line" text for a completion query.
const MAX_SUGGEST_INPUT_LEN: usize = 4096;

/// SubcommandSpec 描述容器命令（如 `CONFIG`/`CLUSTER`）下的一个静态子命令。
pub struct SubcommandSpec {
    pub name: &'static str,
    pub summary: &'static str,
    /// 子命令自身的参数签名（不含命令名与子命令名）。
    pub arguments: &'static str,
    pub since: &'static str,
}

/// CommandSpec 描述单条 Redis 顶层命令的静态元数据。
pub struct CommandSpec {
    pub name: &'static str,
    pub summary: &'static str,
    /// 顶层参数签名；若 `subcommands` 非空，这里通常是 `"subcommand ..."` 占位符，
    /// 真正的参数提示来自匹配到的具体子命令。
    pub arguments: &'static str,
    pub since: &'static str,
    pub group: &'static str,
    /// 该命令支持的子命令表；绝大多数命令为空切片。
    pub subcommands: &'static [SubcommandSpec],
}

/// DynSubcommand 是从连接会话的 `COMMAND DOCS` 回复解析出的子命令元数据（对应 `SubcommandSpec`
/// 的动态版本，字段为拥有所有权的 `String`）。
#[derive(Clone)]
pub struct DynSubcommand {
    pub name: String,
    pub summary: String,
    pub arguments: String,
    pub since: String,
}

/// DynCommand 是从连接会话的 `COMMAND DOCS` 回复解析出的顶层命令元数据。
#[derive(Clone)]
pub struct DynCommand {
    pub name: String,
    pub summary: String,
    pub arguments: String,
    pub since: String,
    pub group: String,
    pub subcommands: Vec<DynSubcommand>,
}

/// SubcommandTable 抽象出"子命令"的公共只读视图，供补全引擎同时支持静态/动态两套数据。
trait SubcommandTable {
    fn name(&self) -> &str;
    fn summary(&self) -> &str;
    fn arguments(&self) -> &str;
    fn since(&self) -> &str;
}

/// CommandTable 抽象出"顶层命令"的公共只读视图。
trait CommandTable {
    type Sub: SubcommandTable;
    fn name(&self) -> &str;
    fn summary(&self) -> &str;
    fn arguments(&self) -> &str;
    fn since(&self) -> &str;
    fn group(&self) -> &str;
    fn subcommands(&self) -> &[Self::Sub];
}

impl SubcommandTable for SubcommandSpec {
    fn name(&self) -> &str {
        self.name
    }
    fn summary(&self) -> &str {
        self.summary
    }
    fn arguments(&self) -> &str {
        self.arguments
    }
    fn since(&self) -> &str {
        self.since
    }
}

impl CommandTable for CommandSpec {
    type Sub = SubcommandSpec;
    fn name(&self) -> &str {
        self.name
    }
    fn summary(&self) -> &str {
        self.summary
    }
    fn arguments(&self) -> &str {
        self.arguments
    }
    fn since(&self) -> &str {
        self.since
    }
    fn group(&self) -> &str {
        self.group
    }
    fn subcommands(&self) -> &[SubcommandSpec] {
        self.subcommands
    }
}

impl SubcommandTable for DynSubcommand {
    fn name(&self) -> &str {
        &self.name
    }
    fn summary(&self) -> &str {
        &self.summary
    }
    fn arguments(&self) -> &str {
        &self.arguments
    }
    fn since(&self) -> &str {
        &self.since
    }
}

impl CommandTable for DynCommand {
    type Sub = DynSubcommand;
    fn name(&self) -> &str {
        &self.name
    }
    fn summary(&self) -> &str {
        &self.summary
    }
    fn arguments(&self) -> &str {
        &self.arguments
    }
    fn since(&self) -> &str {
        &self.since
    }
    fn group(&self) -> &str {
        &self.group
    }
    fn subcommands(&self) -> &[DynSubcommand] {
        &self.subcommands
    }
}

/// suggest 在打包的静态命令表中查找建议（无 I/O，无需已连接会话）。
pub fn suggest(input: &str) -> Value {
    suggest_generic(input, COMMANDS)
}

/// suggest_dynamic 在某个已连接会话的 `COMMAND DOCS` 动态表中查找建议。
pub fn suggest_dynamic(input: &str, table: &[DynCommand]) -> Value {
    suggest_generic(input, table)
}

/// suggest_generic 是补全引擎本体，静态/动态两个入口共用同一套解析与位置感知提示逻辑。
///
/// 解析规则（按"命令名 [子命令名] 参数..."逐段拆分，命令名/子命令名视为不含引号的裸词）：
/// - 输入为空，或只有一个尚未以空白结尾的词：当作命令名前缀，返回匹配的顶层命令列表。
/// - 命令名已完整输入（后面跟了空白或更多内容）：
///   - 若该命令没有子命令表，返回它自身的参数签名，并附带 `remainingArguments`——根据已经
///     输入了多少个参数（做引号感知的计数，避免把带空格的引号取值算成多个参数），从参数签名
///     中跳过相应数量的"顶层参数单元"后剩下的部分，让提示随输入逐步收窄。
///   - 若该命令有子命令表，对第二个词做同样的前缀/精确匹配处理，解析到具体子命令后返回该
///     子命令自身的参数签名与收窄提示。
/// - 命令名不是已知命令：返回空列表。
fn suggest_generic<C: CommandTable>(input: &str, table: &[C]) -> Value {
    let input = truncate_suggest_input(input);
    let raw = input.trim_start();
    if raw.is_empty() {
        return suggest_top_level(table, "");
    }
    let ends_with_space = raw.ends_with(char::is_whitespace);
    let (command_word, after_command) = split_first_word(raw);

    if after_command.is_empty() && !ends_with_space {
        return suggest_top_level(table, &command_word.to_ascii_uppercase());
    }

    let command_name = command_word.to_ascii_uppercase();
    let Some(spec) = table.iter().find(|c| c.name() == command_name) else {
        return json!({ "suggestions": Vec::<Value>::new() });
    };

    if spec.subcommands().is_empty() {
        return json!({ "suggestions": [command_to_json_with_hint(spec, after_command, ends_with_space)] });
    }
    if after_command.is_empty() {
        return suggest_subcommands(spec, "");
    }

    let (sub_word, after_sub) = split_first_word(after_command);
    if after_sub.is_empty() && !ends_with_space {
        return suggest_subcommands(spec, &sub_word.to_ascii_uppercase());
    }
    let sub_name = sub_word.to_ascii_uppercase();
    match spec.subcommands().iter().find(|s| s.name() == sub_name) {
        Some(sub) => json!({ "suggestions": [subcommand_to_json_with_hint(spec, sub, after_sub, ends_with_space)] }),
        None => json!({ "suggestions": Vec::<Value>::new() }),
    }
}

/// truncate_suggest_input 在字符边界上安全截断超长输入，避免处理任意大的字符串。
fn truncate_suggest_input(input: &str) -> &str {
    match input.char_indices().nth(MAX_SUGGEST_INPUT_LEN) {
        Some((byte_idx, _)) => &input[..byte_idx],
        None => input,
    }
}

/// split_first_word 从（已去掉前导空白的）字符串中取出第一个空白分隔的词，返回
/// `(词, 词后剩余部分)`；剩余部分会去掉前导空白，但保留原始的结尾空白状态。
fn split_first_word(s: &str) -> (&str, &str) {
    match s.find(char::is_whitespace) {
        Some(idx) => (&s[..idx], s[idx..].trim_start()),
        None => (s, ""),
    }
}

fn suggest_top_level<C: CommandTable>(table: &[C], prefix: &str) -> Value {
    let mut matches: Vec<&C> = table.iter().filter(|c| c.name().starts_with(prefix)).collect();
    matches.sort_by(|a, b| a.name().cmp(b.name()));
    matches.truncate(MAX_SUGGESTIONS);
    json!({ "suggestions": matches.into_iter().map(command_to_json).collect::<Vec<_>>() })
}

fn suggest_subcommands<C: CommandTable>(parent: &C, prefix: &str) -> Value {
    let mut matches: Vec<&C::Sub> = parent.subcommands().iter().filter(|s| s.name().starts_with(prefix)).collect();
    matches.sort_by(|a, b| a.name().cmp(b.name()));
    matches.truncate(MAX_SUGGESTIONS);
    json!({ "suggestions": matches.into_iter().map(|s| subcommand_to_json(parent, s)).collect::<Vec<_>>() })
}

fn command_to_json<C: CommandTable>(spec: &C) -> Value {
    json!({
        "name": spec.name(),
        "summary": spec.summary(),
        "arguments": spec.arguments(),
        "since": spec.since(),
        "group": spec.group(),
    })
}

/// command_to_json_with_hint 在 `command_to_json` 基础上附加 `remainingArguments`。
fn command_to_json_with_hint<C: CommandTable>(spec: &C, typed_rest: &str, ends_with_space: bool) -> Value {
    let mut v = command_to_json(spec);
    v["remainingArguments"] = json!(remaining_arguments(spec.arguments(), typed_rest, ends_with_space));
    v
}

/// subcommand_to_json 附带父命令名（`parentCommand`）与拼接后的完整名（`name`，如
/// `"CONFIG GET"`），便于前端直接用于补全替换或展示。
fn subcommand_to_json<C: CommandTable>(parent: &C, sub: &C::Sub) -> Value {
    json!({
        "name": format!("{} {}", parent.name(), sub.name()),
        "parentCommand": parent.name(),
        "subcommand": sub.name(),
        "summary": sub.summary(),
        "arguments": sub.arguments(),
        "since": sub.since(),
        "group": parent.group(),
    })
}

fn subcommand_to_json_with_hint<C: CommandTable>(
    parent: &C,
    sub: &C::Sub,
    typed_rest: &str,
    ends_with_space: bool,
) -> Value {
    let mut v = subcommand_to_json(parent, sub);
    v["remainingArguments"] = json!(remaining_arguments(sub.arguments(), typed_rest, ends_with_space));
    v
}

/// remaining_arguments 根据"已经输入了多少个参数"从完整参数签名中跳过相应数量的顶层参数
/// 单元，返回还没被满足的那部分签名，让提示随输入逐步收窄（而不是始终展示整条签名）。
fn remaining_arguments(full_spec: &str, typed_rest: &str, ends_with_space: bool) -> String {
    let tokens = split_top_level_tokens(full_spec);
    if tokens.is_empty() {
        return String::new();
    }
    let typed_count = count_typed_arguments(typed_rest);
    // 结尾有空白说明最后一个参数已经"敲完"，可以跳过；否则最后一个参数仍在输入中，继续展示
    // 它对应的提示，不要跳过。
    let skip = if ends_with_space {
        typed_count
    } else {
        typed_count.saturating_sub(1)
    };
    let skip = skip.min(tokens.len());
    tokens[skip..].join(" ")
}

/// split_top_level_tokens 把参数签名字符串切分成"概念上的参数单元"：方括号内的内容（如
/// `[EX seconds|PX milliseconds]`）即使含有空格，也整体算作一个参数位置，因为使用者在这里是
/// 做一次性选择，而不是逐词填写。方括号不支持转义/嵌套之外的其它语法，签名字符串完全由本文件
/// 中的静态数据或 `commanddocs` 渲染产生，格式受控。
fn split_top_level_tokens(spec: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut depth: i32 = 0;
    let mut start: Option<usize> = None;
    for (idx, ch) in spec.char_indices() {
        match ch {
            '[' => {
                depth = depth.saturating_add(1);
                if start.is_none() {
                    start = Some(idx);
                }
            }
            ']' => {
                depth = depth.saturating_sub(1);
            }
            c if c.is_whitespace() && depth <= 0 => {
                if let Some(s) = start.take() {
                    tokens.push(&spec[s..idx]);
                }
            }
            _ => {
                if start.is_none() {
                    start = Some(idx);
                }
            }
        }
    }
    if let Some(s) = start {
        tokens.push(&spec[s..]);
    }
    tokens
}

/// count_typed_arguments 对"已经输入的参数部分"做引号感知的计数：带引号的取值（哪怕内部有
/// 空格）算作一个参数，未闭合的引号视为"仍在输入这一个参数"而不是报错或死循环。
fn count_typed_arguments(rest: &str) -> usize {
    let mut count = 0usize;
    let mut chars = rest.trim().chars().peekable();
    while chars.peek().is_some() {
        while matches!(chars.peek(), Some(c) if c.is_whitespace()) {
            chars.next();
        }
        let Some(&first) = chars.peek() else { break };
        if first == '"' || first == '\'' {
            let quote = first;
            chars.next();
            for c in chars.by_ref() {
                if c == quote {
                    break;
                }
            }
        } else {
            while matches!(chars.peek(), Some(c) if !c.is_whitespace()) {
                chars.next();
            }
        }
        count = count.saturating_add(1);
    }
    count
}

macro_rules! cmd {
    ($name:expr, $summary:expr, $arguments:expr, $since:expr, $group:expr) => {
        CommandSpec {
            name: $name,
            summary: $summary,
            arguments: $arguments,
            since: $since,
            group: $group,
            subcommands: &[],
        }
    };
    ($name:expr, $summary:expr, $arguments:expr, $since:expr, $group:expr, $subs:expr) => {
        CommandSpec {
            name: $name,
            summary: $summary,
            arguments: $arguments,
            since: $since,
            group: $group,
            subcommands: $subs,
        }
    };
}

macro_rules! sub {
    ($name:expr, $summary:expr, $arguments:expr, $since:expr) => {
        SubcommandSpec {
            name: $name,
            summary: $summary,
            arguments: $arguments,
            since: $since,
        }
    };
}

const CONFIG_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("GET", "获取配置项当前值", "parameter [parameter ...]", "2.0.0"),
    sub!("SET", "修改配置项", "parameter value [parameter value ...]", "2.0.0"),
    sub!("REWRITE", "将当前配置写回配置文件", "", "2.8.0"),
    sub!("RESETSTAT", "重置 INFO 中的统计计数器", "", "2.0.0"),
];

const CLIENT_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("LIST", "列出所有已连接客户端", "[TYPE normal|master|replica|pubsub] [ID client-id [client-id ...]]", "2.4.0"),
    sub!("KILL", "关闭指定客户端连接", "[ID client-id] [ADDR ip:port] [LADDR ip:port] [SKIPME yes|no] [MAXAGE seconds]", "2.4.0"),
    sub!("GETNAME", "获取当前连接名称", "", "2.6.9"),
    sub!("SETNAME", "设置当前连接名称", "connection-name", "2.6.9"),
    sub!("ID", "获取当前连接 ID", "", "5.0.0"),
    sub!("INFO", "获取当前连接的详细信息", "", "6.2.0"),
    sub!("PAUSE", "暂停处理客户端命令", "timeout [WRITE|ALL]", "3.0.0"),
    sub!("UNPAUSE", "恢复处理客户端命令", "", "6.2.0"),
    sub!("REPLY", "控制服务器是否返回回复", "ON|OFF|SKIP", "3.2.0"),
    sub!("NO-EVICT", "为当前连接开关内存驱逐豁免", "ON|OFF", "7.0.0"),
    sub!("NO-TOUCH", "为当前连接开关 key 访问时间更新", "ON|OFF", "7.2.0"),
    sub!("UNBLOCK", "解除指定客户端的阻塞状态", "client-id [TIMEOUT|ERROR]", "5.0.0"),
    sub!("SETINFO", "设置连接的库名/版本等元信息", "attr value", "7.2.0"),
    sub!("CACHING", "控制客户端缓存追踪的开关（OPTIN/OPTOUT 模式下）", "YES|NO", "6.0.0"),
    sub!("TRACKING", "开启/关闭客户端缓存失效追踪", "ON|OFF [REDIRECT client-id] [PREFIX prefix ...] [BCAST] [OPTIN] [OPTOUT] [NOLOOP]", "6.0.0"),
    sub!("TRACKINGINFO", "查看当前连接的追踪状态", "", "6.2.0"),
    sub!("GETREDIR", "查看当前连接失效通知的重定向目标", "", "6.0.0"),
];

const ACL_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("CAT", "列出权限分类（或分类下的命令）", "[categoryname]", "6.0.0"),
    sub!("DELUSER", "删除一个或多个用户", "username [username ...]", "6.0.0"),
    sub!("DRYRUN", "模拟检查用户是否有权限执行某命令", "username command [arg ...]", "7.0.0"),
    sub!("GENPASS", "生成随机密码", "[bits]", "6.0.0"),
    sub!("GETUSER", "查看用户的权限规则", "username", "6.0.0"),
    sub!("LIST", "列出所有用户及其规则", "", "6.0.0"),
    sub!("LOAD", "从 ACL 配置文件重新加载规则", "", "6.0.0"),
    sub!("LOG", "查看/清空权限拒绝日志", "[count|RESET]", "6.0.0"),
    sub!("SAVE", "将当前规则保存到 ACL 配置文件", "", "6.0.0"),
    sub!("SETUSER", "创建或修改用户规则", "username [rule ...]", "6.0.0"),
    sub!("USERS", "列出所有用户名", "", "6.0.0"),
    sub!("WHOAMI", "查看当前连接使用的用户名", "", "6.0.0"),
];

const MEMORY_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("USAGE", "估算 key 占用的内存字节数", "key [SAMPLES count]", "4.0.0"),
    sub!("STATS", "查看内存分配详细统计", "", "4.0.0"),
    sub!("DOCTOR", "给出内存使用的诊断建议", "", "4.0.0"),
    sub!("PURGE", "尝试让分配器归还空闲内存", "", "4.0.0"),
    sub!("MALLOC-STATS", "打印底层分配器的原始统计信息", "", "4.0.0"),
];

const XGROUP_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("CREATE", "创建消费者组", "key group id|$ [MKSTREAM] [ENTRIESREAD entries-read]", "5.0.0"),
    sub!("SETID", "设置消费者组的最后投递 ID", "key group id|$ [ENTRIESREAD entries-read]", "5.0.0"),
    sub!("DESTROY", "删除消费者组", "key group", "5.0.0"),
    sub!("CREATECONSUMER", "在组内创建消费者", "key group consumer", "6.2.0"),
    sub!("DELCONSUMER", "删除组内消费者", "key group consumer", "5.0.0"),
];

const XINFO_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("STREAM", "查看流的详细信息", "key [FULL [COUNT count]]", "5.0.0"),
    sub!("GROUPS", "查看流上的消费者组", "key", "5.0.0"),
    sub!("CONSUMERS", "查看消费者组内的消费者", "key group", "5.0.0"),
];

const SLOWLOG_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("GET", "获取慢查询日志条目", "[count]", "2.2.12"),
    sub!("LEN", "获取慢查询日志条目数量", "", "2.2.12"),
    sub!("RESET", "清空慢查询日志", "", "2.2.12"),
];

const SCRIPT_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("LOAD", "将脚本加载进脚本缓存并返回 SHA1", "script", "2.6.0"),
    sub!("EXISTS", "判断脚本是否已缓存", "sha1 [sha1 ...]", "2.6.0"),
    sub!("FLUSH", "清空脚本缓存", "[ASYNC|SYNC]", "2.6.0"),
    sub!("KILL", "终止正在执行的脚本", "", "2.6.0"),
];

const OBJECT_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("ENCODING", "查看 key 的底层编码方式", "key", "2.2.3"),
    sub!("FREQ", "查看 key 的访问频率计数（需 LFU 淘汰策略）", "key", "4.0.0"),
    sub!("IDLETIME", "查看 key 的空闲时间（秒）", "key", "2.2.3"),
    sub!("REFCOUNT", "查看 key 值的引用计数", "key", "2.2.3"),
];

const DEBUG_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("OBJECT", "查看 key 的内部调试信息", "key", "1.0.0"),
    sub!("SLEEP", "使服务器阻塞指定秒数（仅用于排障）", "seconds", "1.0.0"),
    sub!("SET-ACTIVE-EXPIRE", "开关后台主动过期扫描", "0|1", "1.0.0"),
    sub!("JSON", "查看 JSON 兼容性调试信息", "key", "4.0.0"),
    sub!("RELOAD", "从磁盘重新加载 RDB", "", "1.0.0"),
    sub!("FLUSHALL", "清空所有数据库（跳过 AOF/复制）", "", "1.0.0"),
    sub!("DIGEST", "计算整个数据集的摘要", "", "1.0.0"),
    sub!("DIGEST-VALUE", "计算指定 key 的摘要", "key [key ...]", "1.0.0"),
    sub!("QUICKLIST-PACKED-THRESHOLD", "设置 quicklist 大节点阈值", "size", "3.2.0"),
    sub!("STRINGMATCH-LEN", "测试 glob 匹配（调试用）", "pattern value", "1.0.0"),
    sub!("CHANGE-REPL-ID", "更换复制 ID", "", "5.0.0"),
];

const COMMAND_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("COUNT", "获取服务器支持的命令总数", "", "2.8.13"),
    sub!("DOCS", "获取命令的详细文档", "[command-name [command-name ...]]", "7.0.0"),
    sub!("GETKEYS", "从一条命令中提取涉及的 key 名", "command [arg ...]", "2.8.13"),
    sub!("GETKEYSANDFLAGS", "提取 key 名及其访问标志", "command [arg ...]", "7.0.0"),
    sub!("INFO", "获取指定命令的元数据", "[command-name [command-name ...]]", "2.8.13"),
    sub!("LIST", "列出所有命令名", "[FILTERBY MODULE module-name|ACLCAT category|PATTERN pattern]", "7.0.0"),
];

const LATENCY_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("HISTORY", "查看指定事件的延迟采样历史", "event-name", "2.8.13"),
    sub!("LATEST", "查看所有事件的最新延迟采样", "", "2.8.13"),
    sub!("RESET", "重置延迟监控数据", "[event-name ...]", "2.8.13"),
    sub!("GRAPH", "以图表形式查看延迟采样", "event-name", "2.8.13"),
    sub!("DOCTOR", "给出延迟问题的诊断建议", "", "2.8.13"),
];

const PUBSUB_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("CHANNELS", "列出当前有订阅者的频道", "[pattern]", "2.8.0"),
    sub!("NUMSUB", "查看频道的订阅者数量", "[channel ...]", "2.8.0"),
    sub!("NUMPAT", "查看按模式订阅的数量", "", "2.8.0"),
    sub!("SHARDCHANNELS", "列出当前有订阅者的分片频道", "[pattern]", "7.0.0"),
    sub!("SHARDNUMSUB", "查看分片频道的订阅者数量", "[shardchannel ...]", "7.0.0"),
];

const CLUSTER_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("INFO", "查看集群运行状态摘要", "", "3.0.0"),
    sub!("NODES", "以纯文本格式列出集群节点", "", "3.0.0"),
    sub!("SHARDS", "查看分片与槽位分配信息", "", "7.0.0"),
    sub!("SLOTS", "查看槽位分配（已被 SHARDS 取代）", "", "3.0.0"),
    sub!("MYID", "查看当前节点 ID", "", "3.0.0"),
    sub!("KEYSLOT", "计算 key 所属的槽位编号", "key", "3.0.0"),
    sub!("COUNTKEYSINSLOT", "统计槽位内的 key 数量", "slot", "3.0.0"),
    sub!("GETKEYSINSLOT", "获取槽位内的 key 列表", "slot count", "3.0.0"),
    sub!("MEET", "让节点加入集群", "ip port [cluster-bus-port]", "3.0.0"),
    sub!("FORGET", "从集群视图中移除节点", "node-id", "3.0.0"),
    sub!("REPLICATE", "将当前节点设为指定节点的副本", "node-id", "3.0.0"),
    sub!("FAILOVER", "在副本上手动触发故障转移", "[FORCE|TAKEOVER]", "3.0.0"),
    sub!("RESET", "重置节点的集群配置", "[HARD|SOFT]", "3.0.0"),
    sub!("SET-CONFIG-EPOCH", "为新节点设置配置纪元", "config-epoch", "3.0.0"),
    sub!("BUMPEPOCH", "递增节点的配置纪元", "", "3.0.0"),
    sub!("ADDSLOTS", "为节点分配槽位", "slot [slot ...]", "3.0.0"),
    sub!("DELSLOTS", "移除节点的槽位", "slot [slot ...]", "3.0.0"),
    sub!("ADDSLOTSRANGE", "按区间批量分配槽位", "start-slot end-slot [start-slot end-slot ...]", "7.0.0"),
    sub!("DELSLOTSRANGE", "按区间批量移除槽位", "start-slot end-slot [start-slot end-slot ...]", "7.0.0"),
    sub!("SETSLOT", "变更单个槽位的迁移状态", "slot IMPORTING|MIGRATING|STABLE|NODE node-id", "3.0.0"),
    sub!("SAVECONFIG", "将集群配置强制写入磁盘", "", "3.0.0"),
    sub!("LINKS", "查看集群总线连接状态", "", "7.0.0"),
];

const FUNCTION_SUBCOMMANDS: &[SubcommandSpec] = &[
    sub!("LOAD", "加载函数库", "[REPLACE] function-code", "7.0.0"),
    sub!("DELETE", "删除函数库", "library-name", "7.0.0"),
    sub!("FLUSH", "删除所有函数库", "[ASYNC|SYNC]", "7.0.0"),
    sub!("LIST", "列出已加载的函数库", "[LIBRARYNAME library-name] [WITHCODE]", "7.0.0"),
    sub!("DUMP", "序列化所有函数库", "", "7.0.0"),
    sub!("RESTORE", "从序列化数据恢复函数库", "serialized-payload [FLUSH|APPEND|REPLACE]", "7.0.0"),
    sub!("STATS", "查看函数执行统计与运行中脚本", "", "7.0.0"),
    sub!("KILL", "终止正在执行的函数", "", "7.0.0"),
];

pub const COMMANDS: &[CommandSpec] = &[
    // Connection
    cmd!("PING", "测试连接是否存活", "[message]", "1.0.0", "connection"),
    cmd!("ECHO", "回显给定字符串", "message", "1.0.0", "connection"),
    cmd!("AUTH", "身份验证", "[username] password", "1.0.0", "connection"),
    cmd!("SELECT", "切换逻辑数据库", "index", "1.0.0", "connection"),
    cmd!("HELLO", "切换协议版本并返回服务器信息", "[protover [AUTH user pass] [SETNAME name]]", "6.0.0", "connection"),
    cmd!("RESET", "重置当前连接状态（退出订阅/事务/MONITOR 等模式）", "", "6.2.0", "connection"),
    cmd!("CLIENT", "客户端连接管理", "subcommand [args...]", "2.4.0", "connection", CLIENT_SUBCOMMANDS),
    cmd!("QUIT", "关闭连接", "", "1.0.0", "connection"),
    // Generic / key
    cmd!("DEL", "删除一个或多个 key", "key [key ...]", "1.0.0", "generic"),
    cmd!("UNLINK", "异步删除一个或多个 key", "key [key ...]", "4.0.0", "generic"),
    cmd!("EXISTS", "判断 key 是否存在", "key [key ...]", "1.0.0", "generic"),
    cmd!("EXPIRE", "设置 key 的过期时间（秒）", "key seconds [NX|XX|GT|LT]", "1.0.0", "generic"),
    cmd!("PEXPIRE", "设置 key 的过期时间（毫秒）", "key milliseconds [NX|XX|GT|LT]", "2.6.0", "generic"),
    cmd!("EXPIREAT", "设置 key 的过期时间点（秒级时间戳）", "key timestamp [NX|XX|GT|LT]", "1.2.0", "generic"),
    cmd!("PEXPIREAT", "设置 key 的过期时间点（毫秒级时间戳）", "key ms-timestamp [NX|XX|GT|LT]", "2.6.0", "generic"),
    cmd!("EXPIRETIME", "查看 key 的过期时间点（秒级时间戳）", "key", "7.0.0", "generic"),
    cmd!("PEXPIRETIME", "查看 key 的过期时间点（毫秒级时间戳）", "key", "7.0.0", "generic"),
    cmd!("TTL", "查看 key 剩余存活时间（秒）", "key", "1.0.0", "generic"),
    cmd!("PTTL", "查看 key 剩余存活时间（毫秒）", "key", "2.6.0", "generic"),
    cmd!("PERSIST", "移除 key 的过期时间", "key", "2.2.0", "generic"),
    cmd!("TYPE", "查看 key 的数据类型", "key", "1.0.0", "generic"),
    cmd!("RENAME", "重命名 key", "key newkey", "1.0.0", "generic"),
    cmd!("RENAMENX", "仅当 newkey 不存在时重命名", "key newkey", "1.0.0", "generic"),
    cmd!("KEYS", "按 glob 模式查找 key（生产环境慎用）", "pattern", "1.0.0", "generic"),
    cmd!("SCAN", "增量式遍历 key 空间", "cursor [MATCH pattern] [COUNT count] [TYPE type]", "2.8.0", "generic"),
    cmd!("RANDOMKEY", "随机返回一个 key", "", "1.0.0", "generic"),
    cmd!("DUMP", "序列化 key 的值", "key", "2.6.0", "generic"),
    cmd!("RESTORE", "反序列化并写入 key", "key ttl serialized-value [REPLACE]", "2.6.0", "generic"),
    cmd!("COPY", "复制 key", "source destination [DB destination-db] [REPLACE]", "6.2.0", "generic"),
    cmd!("MOVE", "将 key 移动到指定数据库", "key db", "1.0.0", "generic"),
    cmd!("TOUCH", "更新 key 的最近访问时间", "key [key ...]", "3.2.1", "generic"),
    cmd!("OBJECT", "查看 key 的内部信息", "subcommand key", "2.2.3", "generic", OBJECT_SUBCOMMANDS),
    cmd!("SORT", "对列表/集合/有序集合排序", "key [BY pattern] [LIMIT offset count] [GET pattern] [ASC|DESC]", "1.0.0", "generic"),
    cmd!("SORT_RO", "SORT 的只读版本（无 STORE）", "key [BY pattern] [LIMIT offset count] [GET pattern] [ASC|DESC] [ALPHA]", "7.0.0", "generic"),
    // String
    cmd!("SET", "设置字符串值", "key value [EX sec|PX ms|EXAT ts|PXAT ts|KEEPTTL] [NX|XX] [GET]", "1.0.0", "string"),
    cmd!("GET", "获取字符串值", "key", "1.0.0", "string"),
    cmd!("GETSET", "设置新值并返回旧值", "key value", "1.0.0", "string"),
    cmd!("GETDEL", "获取值并删除 key", "key", "6.2.0", "string"),
    cmd!("GETEX", "获取值并可选地更新过期时间", "key [EX sec|PX ms|EXAT ts|PXAT ts|PERSIST]", "6.2.0", "string"),
    cmd!("SETNX", "仅当 key 不存在时设置", "key value", "1.0.0", "string"),
    cmd!("SETEX", "设置字符串值并指定过期秒数", "key seconds value", "2.0.0", "string"),
    cmd!("PSETEX", "设置字符串值并指定过期毫秒数", "key milliseconds value", "2.6.0", "string"),
    cmd!("MSET", "批量设置多个键值", "key value [key value ...]", "1.0.1", "string"),
    cmd!("MSETNX", "批量设置（仅当所有 key 都不存在）", "key value [key value ...]", "1.0.1", "string"),
    cmd!("MGET", "批量获取多个 key 的值", "key [key ...]", "1.0.0", "string"),
    cmd!("INCR", "值加一", "key", "1.0.0", "string"),
    cmd!("DECR", "值减一", "key", "1.0.0", "string"),
    cmd!("INCRBY", "值增加指定整数", "key increment", "1.0.0", "string"),
    cmd!("DECRBY", "值减少指定整数", "key decrement", "1.0.0", "string"),
    cmd!("INCRBYFLOAT", "值增加指定浮点数", "key increment", "2.6.0", "string"),
    cmd!("APPEND", "在字符串末尾追加内容", "key value", "2.0.0", "string"),
    cmd!("STRLEN", "返回字符串长度", "key", "2.2.0", "string"),
    cmd!("GETRANGE", "获取字符串子串", "key start end", "2.4.0", "string"),
    cmd!("SETRANGE", "覆盖字符串的指定区间", "key offset value", "2.2.0", "string"),
    cmd!("LCS", "计算两个字符串的最长公共子序列", "key1 key2 [LEN] [IDX] [MINMATCHLEN len] [WITHMATCHLEN]", "7.0.0", "string"),
    // Hash
    cmd!("HSET", "设置哈希字段", "key field value [field value ...]", "2.0.0", "hash"),
    cmd!("HSETNX", "仅当字段不存在时设置", "key field value", "2.0.0", "hash"),
    cmd!("HGET", "获取哈希字段值", "key field", "2.0.0", "hash"),
    cmd!("HMGET", "批量获取哈希字段值", "key field [field ...]", "2.0.0", "hash"),
    cmd!("HGETALL", "获取哈希全部字段与值", "key", "2.0.0", "hash"),
    cmd!("HDEL", "删除哈希字段", "key field [field ...]", "2.0.0", "hash"),
    cmd!("HEXISTS", "判断哈希字段是否存在", "key field", "2.0.0", "hash"),
    cmd!("HINCRBY", "哈希字段值增加整数", "key field increment", "2.0.0", "hash"),
    cmd!("HINCRBYFLOAT", "哈希字段值增加浮点数", "key field increment", "2.6.0", "hash"),
    cmd!("HKEYS", "获取哈希全部字段名", "key", "2.0.0", "hash"),
    cmd!("HVALS", "获取哈希全部字段值", "key", "2.0.0", "hash"),
    cmd!("HLEN", "获取哈希字段数量", "key", "2.0.0", "hash"),
    cmd!("HSCAN", "增量式遍历哈希字段", "key cursor [MATCH pattern] [COUNT count]", "2.8.0", "hash"),
    cmd!("HRANDFIELD", "随机返回哈希字段", "key [count [WITHVALUES]]", "6.2.0", "hash"),
    cmd!("HGETEX", "获取哈希字段值并可选地更新其过期时间", "key [EX sec|PX ms|EXAT ts|PXAT ts|PERSIST] FIELDS numfields field [field ...]", "7.4.0", "hash"),
    cmd!("HGETDEL", "获取哈希字段值并删除该字段", "key FIELDS numfields field [field ...]", "7.4.0", "hash"),
    cmd!("HEXPIRE", "设置哈希字段的过期时间（秒）", "key seconds [NX|XX|GT|LT] FIELDS numfields field [field ...]", "7.4.0", "hash"),
    cmd!("HPEXPIRE", "设置哈希字段的过期时间（毫秒）", "key milliseconds [NX|XX|GT|LT] FIELDS numfields field [field ...]", "7.4.0", "hash"),
    cmd!("HEXPIREAT", "设置哈希字段的过期时间点（秒级时间戳）", "key unix-time-seconds [NX|XX|GT|LT] FIELDS numfields field [field ...]", "7.4.0", "hash"),
    cmd!("HPEXPIREAT", "设置哈希字段的过期时间点（毫秒级时间戳）", "key unix-time-ms [NX|XX|GT|LT] FIELDS numfields field [field ...]", "7.4.0", "hash"),
    cmd!("HPERSIST", "移除哈希字段的过期时间", "key FIELDS numfields field [field ...]", "7.4.0", "hash"),
    cmd!("HTTL", "查看哈希字段剩余存活时间（秒）", "key FIELDS numfields field [field ...]", "7.4.0", "hash"),
    cmd!("HPTTL", "查看哈希字段剩余存活时间（毫秒）", "key FIELDS numfields field [field ...]", "7.4.0", "hash"),
    // List
    cmd!("LPUSH", "从左侧插入元素", "key element [element ...]", "1.0.0", "list"),
    cmd!("RPUSH", "从右侧插入元素", "key element [element ...]", "1.0.0", "list"),
    cmd!("LPUSHX", "仅当 key 存在时从左侧插入", "key element [element ...]", "2.2.0", "list"),
    cmd!("RPUSHX", "仅当 key 存在时从右侧插入", "key element [element ...]", "2.2.0", "list"),
    cmd!("LPOP", "从左侧弹出元素", "key [count]", "1.0.0", "list"),
    cmd!("RPOP", "从右侧弹出元素", "key [count]", "1.0.0", "list"),
    cmd!("LLEN", "获取列表长度", "key", "1.0.0", "list"),
    cmd!("LRANGE", "获取列表指定区间的元素", "key start stop", "1.0.0", "list"),
    cmd!("LINDEX", "按下标获取元素", "key index", "1.0.0", "list"),
    cmd!("LSET", "按下标设置元素", "key index element", "1.0.0", "list"),
    cmd!("LINSERT", "在指定元素前/后插入", "key BEFORE|AFTER pivot element", "2.2.0", "list"),
    cmd!("LREM", "删除列表中匹配的元素", "key count element", "1.0.0", "list"),
    cmd!("LTRIM", "裁剪列表，只保留指定区间", "key start stop", "1.0.0", "list"),
    cmd!("LPOS", "查找元素在列表中的位置", "key element [RANK rank] [COUNT num-matches] [MAXLEN len]", "6.0.6", "list"),
    cmd!("LMOVE", "在两个列表之间原子移动元素", "source destination LEFT|RIGHT LEFT|RIGHT", "6.2.0", "list"),
    cmd!("LMPOP", "从多个列表中弹出元素", "numkeys key [key ...] LEFT|RIGHT [COUNT count]", "7.0.0", "list"),
    cmd!("BLPOP", "阻塞式从左侧弹出", "key [key ...] timeout", "2.0.0", "list"),
    cmd!("BRPOP", "阻塞式从右侧弹出", "key [key ...] timeout", "2.0.0", "list"),
    cmd!("BLMPOP", "阻塞式从多个列表中弹出元素", "timeout numkeys key [key ...] LEFT|RIGHT [COUNT count]", "7.0.0", "list"),
    // Set
    cmd!("SADD", "添加集合成员", "key member [member ...]", "1.0.0", "set"),
    cmd!("SREM", "删除集合成员", "key member [member ...]", "1.0.0", "set"),
    cmd!("SMOVE", "将成员从一个集合移动到另一个集合", "source destination member", "1.0.0", "set"),
    cmd!("SMEMBERS", "获取集合全部成员", "key", "1.0.0", "set"),
    cmd!("SISMEMBER", "判断成员是否在集合中", "key member", "1.0.0", "set"),
    cmd!("SMISMEMBER", "批量判断成员是否在集合中", "key member [member ...]", "6.2.0", "set"),
    cmd!("SCARD", "获取集合成员数量", "key", "1.0.0", "set"),
    cmd!("SPOP", "随机弹出集合成员", "key [count]", "1.0.0", "set"),
    cmd!("SRANDMEMBER", "随机返回集合成员（不删除）", "key [count]", "1.0.0", "set"),
    cmd!("SUNION", "求多个集合的并集", "key [key ...]", "1.0.0", "set"),
    cmd!("SINTER", "求多个集合的交集", "key [key ...]", "1.0.0", "set"),
    cmd!("SINTERCARD", "统计多个集合交集的大小（不实际计算并集）", "numkeys key [key ...] [LIMIT limit]", "7.0.0", "set"),
    cmd!("SDIFF", "求多个集合的差集", "key [key ...]", "1.0.0", "set"),
    cmd!("SUNIONSTORE", "求并集并存储到目标 key", "destination key [key ...]", "1.0.0", "set"),
    cmd!("SINTERSTORE", "求交集并存储到目标 key", "destination key [key ...]", "1.0.0", "set"),
    cmd!("SDIFFSTORE", "求差集并存储到目标 key", "destination key [key ...]", "1.0.0", "set"),
    cmd!("SSCAN", "增量式遍历集合成员", "key cursor [MATCH pattern] [COUNT count]", "2.8.0", "set"),
    // Sorted set
    cmd!("ZADD", "添加有序集合成员", "key [NX|XX] [GT|LT] [CH] [INCR] score member [score member ...]", "1.2.0", "zset"),
    cmd!("ZREM", "删除有序集合成员", "key member [member ...]", "1.2.0", "zset"),
    cmd!("ZSCORE", "获取成员分数", "key member", "1.2.0", "zset"),
    cmd!("ZMSCORE", "批量获取成员分数", "key member [member ...]", "6.2.0", "zset"),
    cmd!("ZCARD", "获取有序集合成员数量", "key", "1.2.0", "zset"),
    cmd!("ZCOUNT", "统计分数区间内的成员数量", "key min max", "2.0.0", "zset"),
    cmd!("ZINCRBY", "增加成员分数", "key increment member", "1.2.0", "zset"),
    cmd!("ZRANK", "获取成员的升序排名", "key member [WITHSCORE]", "2.0.0", "zset"),
    cmd!("ZREVRANK", "获取成员的降序排名", "key member [WITHSCORE]", "2.0.0", "zset"),
    cmd!("ZRANGE", "按排名/分数/字典序获取区间成员", "key start stop [BYSCORE|BYLEX] [REV] [LIMIT offset count] [WITHSCORES]", "1.2.0", "zset"),
    cmd!("ZREVRANGE", "按降序排名获取区间成员", "key start stop [WITHSCORES]", "1.2.0", "zset"),
    cmd!("ZRANGEBYSCORE", "按分数区间获取成员", "key min max [WITHSCORES] [LIMIT offset count]", "1.0.5", "zset"),
    cmd!("ZRANGESTORE", "按区间取出成员并存储到目标 key", "destination source start stop [...]", "6.2.0", "zset"),
    cmd!("ZDIFF", "求多个有序集合的差集", "numkeys key [key ...] [WITHSCORES]", "6.2.0", "zset"),
    cmd!("ZDIFFSTORE", "求差集并存储到目标 key", "destination numkeys key [key ...]", "6.2.0", "zset"),
    cmd!("ZINTER", "求多个有序集合的交集", "numkeys key [key ...] [WEIGHTS weight ...] [AGGREGATE SUM|MIN|MAX] [WITHSCORES]", "6.2.0", "zset"),
    cmd!("ZINTERCARD", "统计多个有序集合交集的大小", "numkeys key [key ...] [LIMIT limit]", "7.0.0", "zset"),
    cmd!("ZUNION", "求多个有序集合的并集", "numkeys key [key ...] [WEIGHTS weight ...] [AGGREGATE SUM|MIN|MAX] [WITHSCORES]", "6.2.0", "zset"),
    cmd!("ZPOPMIN", "弹出分数最低的成员", "key [count]", "5.0.0", "zset"),
    cmd!("ZPOPMAX", "弹出分数最高的成员", "key [count]", "5.0.0", "zset"),
    cmd!("ZMPOP", "从多个有序集合中弹出成员", "numkeys key [key ...] MIN|MAX [COUNT count]", "7.0.0", "zset"),
    cmd!("BZPOPMIN", "阻塞式弹出分数最低的成员", "key [key ...] timeout", "5.0.0", "zset"),
    cmd!("BZPOPMAX", "阻塞式弹出分数最高的成员", "key [key ...] timeout", "5.0.0", "zset"),
    cmd!("BZMPOP", "阻塞式从多个有序集合中弹出成员", "timeout numkeys key [key ...] MIN|MAX [COUNT count]", "7.0.0", "zset"),
    cmd!("ZSCAN", "增量式遍历有序集合成员", "key cursor [MATCH pattern] [COUNT count]", "2.8.0", "zset"),
    // Bitmap
    cmd!("SETBIT", "设置指定偏移量的位", "key offset value", "2.2.0", "bitmap"),
    cmd!("GETBIT", "获取指定偏移量的位", "key offset", "2.2.0", "bitmap"),
    cmd!("BITCOUNT", "统计值为 1 的位数量", "key [start end [BYTE|BIT]]", "2.6.0", "bitmap"),
    cmd!("BITOP", "对多个字符串做位运算", "operation destkey key [key ...]", "2.6.0", "bitmap"),
    cmd!("BITPOS", "查找第一个指定位值的位置", "key bit [start [end [BYTE|BIT]]]", "2.8.7", "bitmap"),
    cmd!("BITFIELD", "对字符串做多字段位操作", "key [GET type offset|SET type offset value|INCRBY type offset increment] [OVERFLOW WRAP|SAT|FAIL]", "3.2.0", "bitmap"),
    cmd!("BITFIELD_RO", "BITFIELD 的只读版本（仅 GET）", "key GET type offset [GET type offset ...]", "6.0.0", "bitmap"),
    // HyperLogLog
    cmd!("PFADD", "添加元素到基数估算结构", "key element [element ...]", "2.8.9", "hyperloglog"),
    cmd!("PFCOUNT", "估算基数（去重计数）", "key [key ...]", "2.8.9", "hyperloglog"),
    cmd!("PFMERGE", "合并多个 HyperLogLog", "destkey sourcekey [sourcekey ...]", "2.8.9", "hyperloglog"),
    // Geo
    cmd!("GEOADD", "添加地理位置成员", "key longitude latitude member [...]", "3.2.0", "geo"),
    cmd!("GEODIST", "计算两个成员之间的距离", "key member1 member2 [m|km|ft|mi]", "3.2.0", "geo"),
    cmd!("GEOPOS", "获取成员的经纬度", "key member [member ...]", "3.2.0", "geo"),
    cmd!("GEOSEARCH", "按范围搜索地理位置成员", "key FROMMEMBER member|FROMLONLAT lon lat BYRADIUS r unit|BYBOX w h unit", "6.2.0", "geo"),
    cmd!("GEOSEARCHSTORE", "按范围搜索并将结果存储到目标 key", "destination source FROMMEMBER member|FROMLONLAT lon lat BYRADIUS r unit|BYBOX w h unit [STOREDIST]", "6.2.0", "geo"),
    // Stream
    cmd!("XADD", "追加消息到流", "key ID field value [field value ...]", "5.0.0", "stream"),
    cmd!("XLEN", "获取流长度", "key", "5.0.0", "stream"),
    cmd!("XRANGE", "按 ID 区间正序读取流消息", "key start end [COUNT count]", "5.0.0", "stream"),
    cmd!("XREVRANGE", "按 ID 区间倒序读取流消息", "key end start [COUNT count]", "5.0.0", "stream"),
    cmd!("XREAD", "读取一个或多个流的新消息", "[COUNT count] [BLOCK ms] STREAMS key [key ...] id [id ...]", "5.0.0", "stream"),
    cmd!("XREADGROUP", "以消费者组身份读取流消息", "GROUP group consumer [COUNT count] [BLOCK ms] [NOACK] STREAMS key [key ...] id [id ...]", "5.0.0", "stream"),
    cmd!("XDEL", "删除流中的消息", "key ID [ID ...]", "5.0.0", "stream"),
    cmd!("XTRIM", "裁剪流长度", "key MAXLEN|MINID [=|~] threshold", "5.0.0", "stream"),
    cmd!("XGROUP", "管理消费者组", "subcommand ...", "5.0.0", "stream", XGROUP_SUBCOMMANDS),
    cmd!("XINFO", "查看流/消费者组/消费者的详细信息", "subcommand ...", "5.0.0", "stream", XINFO_SUBCOMMANDS),
    cmd!("XACK", "确认消费者组已处理的消息", "key group ID [ID ...]", "5.0.0", "stream"),
    cmd!("XCLAIM", "将待处理消息转移给其它消费者", "key group consumer min-idle-time ID [ID ...] [IDLE ms] [RETRYCOUNT count] [FORCE] [JUSTID]", "5.0.0", "stream"),
    cmd!("XAUTOCLAIM", "自动转移超时未确认的消息", "key group consumer min-idle-time start [COUNT count] [JUSTID]", "6.2.0", "stream"),
    cmd!("XPENDING", "查看消费者组的待处理消息", "key group [[IDLE min-idle-time] start end count [consumer]]", "5.0.0", "stream"),
    cmd!("XSETID", "手动设置流的最后一个 ID", "key ID [ENTRIESADDED entries-added] [MAXDELETEDID max-deleted-id]", "5.0.0", "stream"),
    // Pub/Sub
    cmd!("SUBSCRIBE", "订阅一个或多个频道", "channel [channel ...]", "2.0.0", "pubsub"),
    cmd!("UNSUBSCRIBE", "取消订阅频道", "[channel [channel ...]]", "2.0.0", "pubsub"),
    cmd!("PSUBSCRIBE", "按模式订阅频道", "pattern [pattern ...]", "2.0.0", "pubsub"),
    cmd!("PUNSUBSCRIBE", "取消按模式订阅", "[pattern [pattern ...]]", "2.0.0", "pubsub"),
    cmd!("SSUBSCRIBE", "订阅分片频道（集群分片发布订阅）", "shardchannel [shardchannel ...]", "7.0.0", "pubsub"),
    cmd!("SUNSUBSCRIBE", "取消订阅分片频道", "[shardchannel [shardchannel ...]]", "7.0.0", "pubsub"),
    cmd!("PUBLISH", "向频道发布消息", "channel message", "2.0.0", "pubsub"),
    cmd!("SPUBLISH", "向分片频道发布消息", "shardchannel message", "7.0.0", "pubsub"),
    cmd!("PUBSUB", "查看发布/订阅系统状态", "subcommand [args...]", "2.8.0", "pubsub", PUBSUB_SUBCOMMANDS),
    // Transaction
    cmd!("MULTI", "开启事务", "", "1.2.0", "transaction"),
    cmd!("EXEC", "执行事务", "", "1.2.0", "transaction"),
    cmd!("DISCARD", "放弃事务", "", "2.0.0", "transaction"),
    cmd!("WATCH", "监视 key 以实现乐观锁", "key [key ...]", "2.2.0", "transaction"),
    cmd!("UNWATCH", "取消所有监视", "", "2.2.0", "transaction"),
    // Scripting
    cmd!("EVAL", "执行 Lua 脚本", "script numkeys key [key ...] arg [arg ...]", "2.6.0", "scripting"),
    cmd!("EVALSHA", "按 SHA1 执行已缓存的 Lua 脚本", "sha1 numkeys key [key ...] arg [arg ...]", "2.6.0", "scripting"),
    cmd!("EVAL_RO", "EVAL 的只读版本（脚本内不能写）", "script numkeys key [key ...] arg [arg ...]", "7.0.0", "scripting"),
    cmd!("EVALSHA_RO", "EVALSHA 的只读版本", "sha1 numkeys key [key ...] arg [arg ...]", "7.0.0", "scripting"),
    cmd!("FCALL", "调用已加载的函数", "function numkeys [key ...] [arg ...]", "7.0.0", "scripting"),
    cmd!("FCALL_RO", "FCALL 的只读版本", "function numkeys [key ...] [arg ...]", "7.0.0", "scripting"),
    cmd!("SCRIPT", "管理脚本缓存", "subcommand ...", "2.6.0", "scripting", SCRIPT_SUBCOMMANDS),
    cmd!("FUNCTION", "管理服务端函数库", "subcommand ...", "7.0.0", "scripting", FUNCTION_SUBCOMMANDS),
    // Server / admin
    cmd!("INFO", "获取服务器信息与统计数据", "[section [section ...]]", "1.0.0", "server"),
    cmd!("CONFIG", "查看/修改服务器配置", "subcommand ...", "2.0.0", "server", CONFIG_SUBCOMMANDS),
    cmd!("DBSIZE", "返回当前数据库的 key 数量", "", "1.0.0", "server"),
    cmd!("FLUSHDB", "清空当前数据库（危险操作）", "[ASYNC|SYNC]", "1.0.0", "server"),
    cmd!("FLUSHALL", "清空所有数据库（危险操作）", "[ASYNC|SYNC]", "1.0.0", "server"),
    cmd!("MONITOR", "实时打印服务器收到的所有命令（影响性能，谨慎使用）", "", "1.0.0", "server"),
    cmd!("SLOWLOG", "查看/管理慢查询日志", "subcommand ...", "2.2.12", "server", SLOWLOG_SUBCOMMANDS),
    cmd!("COMMAND", "查看命令的元数据", "[subcommand ...]", "2.8.13", "server", COMMAND_SUBCOMMANDS),
    cmd!("TIME", "返回服务器当前时间", "", "2.6.0", "server"),
    cmd!("LASTSAVE", "返回最近一次成功保存的时间", "", "1.0.0", "server"),
    cmd!("SAVE", "同步保存 RDB 快照", "", "1.0.0", "server"),
    cmd!("BGSAVE", "后台异步保存 RDB 快照", "[SCHEDULE]", "1.0.0", "server"),
    cmd!("BGREWRITEAOF", "后台重写 AOF 文件", "", "1.0.0", "server"),
    cmd!("MEMORY", "查看内存使用情况", "subcommand ...", "4.0.0", "server", MEMORY_SUBCOMMANDS),
    cmd!("LATENCY", "查看延迟监控数据", "subcommand ...", "2.8.13", "server", LATENCY_SUBCOMMANDS),
    cmd!("ACL", "访问控制列表管理", "subcommand ...", "6.0.0", "server", ACL_SUBCOMMANDS),
    cmd!("CLUSTER", "集群管理", "subcommand ...", "3.0.0", "server", CLUSTER_SUBCOMMANDS),
    cmd!("REPLICAOF", "配置主从复制关系", "host port|NO ONE", "5.0.0", "server"),
    cmd!("WAIT", "等待写命令同步到指定数量的副本", "numreplicas timeout", "3.0.0", "server"),
    cmd!("FAILOVER", "手动触发一次主从故障转移", "[TO host port [FORCE]] [ABORT] [TIMEOUT ms]", "6.2.0", "server"),
    cmd!("LOLWUT", "显示版本信息与彩蛋图案", "[VERSION version]", "5.0.0", "server"),
    cmd!("DEBUG", "调试相关子命令（仅限排障使用）", "subcommand ...", "1.0.0", "server", DEBUG_SUBCOMMANDS),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_command_names_by_prefix() {
        let result = suggest("GE");
        let names: Vec<&str> = result["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"GET"));
        assert!(names.contains(&"GETRANGE"));
        assert!(!names.contains(&"SET"));
    }

    #[test]
    fn suggests_arguments_once_command_is_typed() {
        let result = suggest("SET ");
        let suggestions = result["suggestions"].as_array().unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0]["name"], "SET");
    }

    #[test]
    fn returns_empty_for_unknown_command_with_arguments() {
        let result = suggest("NOTACOMMAND foo");
        assert_eq!(result["suggestions"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn lists_all_subcommands_after_container_command_and_space() {
        let result = suggest("CONFIG ");
        let names: Vec<&str> = result["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"CONFIG GET"));
        assert!(names.contains(&"CONFIG SET"));
        assert!(names.contains(&"CONFIG REWRITE"));
    }

    #[test]
    fn filters_subcommands_by_prefix() {
        let result = suggest("CLUSTER IN");
        let suggestions = result["suggestions"].as_array().unwrap();
        let names: Vec<&str> = suggestions.iter().map(|v| v["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"CLUSTER INFO"));
        assert!(!names.contains(&"CLUSTER NODES"));
    }

    #[test]
    fn resolves_exact_subcommand_arguments() {
        let result = suggest("CONFIG SET foo bar");
        let suggestions = result["suggestions"].as_array().unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0]["name"], "CONFIG SET");
        assert_eq!(suggestions[0]["parentCommand"], "CONFIG");
        assert_eq!(suggestions[0]["subcommand"], "SET");
    }

    #[test]
    fn unknown_subcommand_returns_empty() {
        let result = suggest("CONFIG NOPE ");
        assert_eq!(result["suggestions"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn remaining_arguments_shows_full_signature_before_any_arg_typed() {
        let result = suggest("SET ");
        let suggestions = result["suggestions"].as_array().unwrap();
        assert_eq!(
            suggestions[0]["remainingArguments"],
            "key value [EX sec|PX ms|EXAT ts|PXAT ts|KEEPTTL] [NX|XX] [GET]"
        );
    }

    #[test]
    fn remaining_arguments_narrows_after_first_arg_completed() {
        // "key" 已经敲完（有尾随空格），提示应该从 "value" 开始。
        let result = suggest("SET mykey ");
        let suggestions = result["suggestions"].as_array().unwrap();
        assert_eq!(
            suggestions[0]["remainingArguments"],
            "value [EX sec|PX ms|EXAT ts|PXAT ts|KEEPTTL] [NX|XX] [GET]"
        );
    }

    #[test]
    fn remaining_arguments_keeps_in_progress_argument_visible() {
        // 没有尾随空格：还在敲 "myval"，此时它应该对应 "value" 这个位置，不应该被跳过。
        let result = suggest("SET mykey myval");
        let suggestions = result["suggestions"].as_array().unwrap();
        assert_eq!(
            suggestions[0]["remainingArguments"],
            "value [EX sec|PX ms|EXAT ts|PXAT ts|KEEPTTL] [NX|XX] [GET]"
        );
    }

    #[test]
    fn remaining_arguments_treats_quoted_value_as_one_argument() {
        let result = suggest(r#"SET mykey "hello world" "#);
        let suggestions = result["suggestions"].as_array().unwrap();
        assert_eq!(
            suggestions[0]["remainingArguments"],
            "[EX sec|PX ms|EXAT ts|PXAT ts|KEEPTTL] [NX|XX] [GET]"
        );
    }

    #[test]
    fn remaining_arguments_never_goes_negative_past_end_of_signature() {
        let result = suggest("PING one two three four");
        let suggestions = result["suggestions"].as_array().unwrap();
        assert_eq!(suggestions[0]["remainingArguments"], "");
    }

    #[test]
    fn remaining_arguments_narrows_for_subcommands_too() {
        let result = suggest("CONFIG SET foo ");
        let suggestions = result["suggestions"].as_array().unwrap();
        assert_eq!(suggestions[0]["remainingArguments"], "value [parameter value ...]");
    }

    #[test]
    fn dynamic_table_suggests_commands_and_subcommands() {
        let table = vec![
            DynCommand {
                name: "GET".to_string(),
                summary: "获取字符串值".to_string(),
                arguments: "key".to_string(),
                since: "1.0.0".to_string(),
                group: "string".to_string(),
                subcommands: Vec::new(),
            },
            DynCommand {
                name: "CONFIG".to_string(),
                summary: "配置管理".to_string(),
                arguments: "subcommand ...".to_string(),
                since: "2.0.0".to_string(),
                group: "server".to_string(),
                subcommands: vec![DynSubcommand {
                    name: "GET".to_string(),
                    summary: "获取配置项".to_string(),
                    arguments: "parameter [parameter ...]".to_string(),
                    since: "2.0.0".to_string(),
                }],
            },
        ];

        let top_level = suggest_dynamic("GE", &table);
        let names: Vec<&str> = top_level["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["GET"]);

        let sub = suggest_dynamic("CONFIG GET foo ", &table);
        let suggestions = sub["suggestions"].as_array().unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0]["name"], "CONFIG GET");
        assert_eq!(suggestions[0]["remainingArguments"], "[parameter ...]");
    }

    #[test]
    fn split_top_level_tokens_treats_bracket_group_as_one_unit() {
        let tokens = split_top_level_tokens("key [key ...]");
        assert_eq!(tokens, vec!["key", "[key ...]"]);
    }

    #[test]
    fn count_typed_arguments_handles_quotes_and_unterminated_quote() {
        assert_eq!(count_typed_arguments(""), 0);
        assert_eq!(count_typed_arguments("foo bar"), 2);
        assert_eq!(count_typed_arguments(r#""hello world" bar"#), 2);
        // Unterminated quote: still counts as one argument currently being typed, and must not
        // hang or panic.
        assert_eq!(count_typed_arguments(r#""still typing"#), 1);
    }
}
