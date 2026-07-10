//! Parses a `COMMAND DOCS` reply from a connected Redis server into the same
//! [`crate::suggest::DynCommand`] shape used for suggestions, so a live session can offer
//! completion that exactly matches that server's actual command set (version, renamed/disabled
//! commands, loaded modules) instead of the bundled static table.
//!
//! The reply is a server-controlled, deeply nestable structure (`arguments` can recurse via
//! `oneof`/`block` argument groups). Every collection we build from it is capped so a very
//! large or unusually shaped reply cannot make this process allocate unbounded memory or
//! recurse without limit.

use crate::suggest::{DynCommand, DynSubcommand};

/// Hard cap on how many top-level commands are kept from a `COMMAND DOCS` reply. Redis itself
/// has on the order of a few hundred commands; this generously covers modules too.
const MAX_DYNAMIC_COMMANDS: usize = 2000;
/// Hard cap on how many subcommands are kept per container command.
const MAX_DYNAMIC_SUBCOMMANDS: usize = 500;
/// Hard cap on how many argument specs are kept at any single nesting level.
const MAX_ARG_SPECS: usize = 128;
/// Hard cap on `oneof`/`block` argument nesting depth.
const MAX_ARG_NESTING_DEPTH: usize = 8;
/// Hard cap on the length of any single string field copied out of the reply.
const MAX_FIELD_LEN: usize = 300;

/// parse_command_docs 把 `COMMAND DOCS` 的原始回复解析为 `DynCommand` 列表；解析失败的字段一律
/// 忽略（留空/跳过），不会导致整体解析失败——静态兜底表已经覆盖了基本可用性。
pub fn parse_command_docs(reply: &redis::Value) -> Vec<DynCommand> {
    as_pairs(reply)
        .into_iter()
        .take(MAX_DYNAMIC_COMMANDS)
        .filter_map(|(name, doc)| parse_command_doc(&name, &doc))
        .collect()
}

/// as_pairs 把 RESP3 `Map` 或 RESP2 语义下代表"映射"的扁平 `Array`（key,value 交替）统一转换成
/// `(String, Value)` 列表；这是 `COMMAND DOCS` 及其嵌套字段在两种协议版本下共用的表示方式。
fn as_pairs(v: &redis::Value) -> Vec<(String, redis::Value)> {
    match v {
        redis::Value::Map(pairs) => pairs
            .iter()
            .map(|(k, val)| (value_to_string(k), val.clone()))
            .collect(),
        redis::Value::Array(items) | redis::Value::Set(items) => items
            .chunks(2)
            .filter(|chunk| chunk.len() == 2)
            .map(|chunk| (value_to_string(&chunk[0]), chunk[1].clone()))
            .collect(),
        _ => Vec::new(),
    }
}

fn value_to_string(v: &redis::Value) -> String {
    match v {
        redis::Value::BulkString(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::Int(n) => n.to_string(),
        redis::Value::Double(d) => d.to_string(),
        _ => String::new(),
    }
}

fn bool_field(v: &redis::Value) -> bool {
    match v {
        redis::Value::Boolean(b) => *b,
        // RESP2 has no native boolean type; the server encodes booleans as 0/1 integers for
        // clients that haven't negotiated RESP3.
        redis::Value::Int(n) => *n != 0,
        redis::Value::SimpleString(s) => s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

fn truncate_field(s: &str) -> String {
    if s.chars().count() <= MAX_FIELD_LEN {
        s.to_string()
    } else {
        s.chars().take(MAX_FIELD_LEN).collect()
    }
}

fn parse_command_doc(name: &str, doc: &redis::Value) -> Option<DynCommand> {
    let mut summary = String::new();
    let mut since = String::new();
    let mut group = String::new();
    let mut arg_specs: Vec<RawArg> = Vec::new();
    let mut subcommands: Vec<DynSubcommand> = Vec::new();

    for (key, val) in as_pairs(doc) {
        match key.as_str() {
            "summary" => summary = value_to_string(&val),
            "since" => since = value_to_string(&val),
            "group" => group = value_to_string(&val),
            "arguments" => arg_specs = parse_arg_list(&val, 0),
            "subcommands" => subcommands = parse_subcommands(&val),
            _ => {}
        }
    }

    Some(DynCommand {
        name: truncate_field(&name.to_ascii_uppercase()),
        summary: truncate_field(&summary),
        arguments: render_arg_list(&arg_specs),
        since: truncate_field(&since),
        group: truncate_field(&group),
        subcommands,
    })
}

fn parse_subcommands(v: &redis::Value) -> Vec<DynSubcommand> {
    as_pairs(v)
        .into_iter()
        .take(MAX_DYNAMIC_SUBCOMMANDS)
        .filter_map(|(full_name, doc)| {
            // Redis names subcommands "parent|sub" (e.g. "config|get") inside COMMAND DOCS;
            // keep only the part after the separator.
            let short_name = full_name.rsplit('|').next().unwrap_or(&full_name).to_string();
            parse_subcommand_doc(&short_name, &doc)
        })
        .collect()
}

fn parse_subcommand_doc(name: &str, doc: &redis::Value) -> Option<DynSubcommand> {
    let mut summary = String::new();
    let mut since = String::new();
    let mut arg_specs: Vec<RawArg> = Vec::new();

    for (key, val) in as_pairs(doc) {
        match key.as_str() {
            "summary" => summary = value_to_string(&val),
            "since" => since = value_to_string(&val),
            "arguments" => arg_specs = parse_arg_list(&val, 0),
            _ => {}
        }
    }

    Some(DynSubcommand {
        name: truncate_field(&name.to_ascii_uppercase()),
        summary: truncate_field(&summary),
        arguments: render_arg_list(&arg_specs),
        since: truncate_field(&since),
    })
}

/// RawArg 是从单条 `arguments` 元素解析出的中间表示，足以渲染出人类可读的签名片段。
struct RawArg {
    /// 参数展示名（"name" 字段），普通参数用它做占位符，如 `key`。
    display: String,
    /// 字面量关键字（"token" 字段），如 `EX`/`NX`；`pure-token` 类型没有附带值，直接展示它。
    token: Option<String>,
    /// "type" 字段：`oneof` 用 `|` 连接候选、`block` 用空格连接一组、`pure-token` 是纯关键字。
    kind: String,
    optional: bool,
    multiple: bool,
    nested: Vec<RawArg>,
}

fn parse_arg_list(v: &redis::Value, depth: usize) -> Vec<RawArg> {
    if depth > MAX_ARG_NESTING_DEPTH {
        return Vec::new();
    }
    match v {
        redis::Value::Array(items) | redis::Value::Set(items) => items
            .iter()
            .take(MAX_ARG_SPECS)
            .filter_map(|item| parse_single_arg(item, depth))
            .collect(),
        _ => Vec::new(),
    }
}

fn parse_single_arg(v: &redis::Value, depth: usize) -> Option<RawArg> {
    if depth > MAX_ARG_NESTING_DEPTH {
        return None;
    }
    let mut display = String::new();
    let mut token: Option<String> = None;
    let mut kind = String::new();
    let mut optional = false;
    let mut multiple = false;
    let mut nested = Vec::new();

    for (key, val) in as_pairs(v) {
        match key.as_str() {
            "name" => display = value_to_string(&val),
            "token" => token = Some(value_to_string(&val)),
            "type" => kind = value_to_string(&val),
            "optional" => optional = bool_field(&val),
            "multiple" => multiple = bool_field(&val),
            "arguments" => nested = parse_arg_list(&val, depth.saturating_add(1)),
            _ => {}
        }
    }

    if display.is_empty() && token.is_none() && nested.is_empty() {
        return None;
    }
    Some(RawArg {
        display: truncate_field(&display),
        token: token.map(|t| truncate_field(&t)),
        kind,
        optional,
        multiple,
        nested,
    })
}

fn render_arg(arg: &RawArg) -> String {
    let core = if arg.kind.eq_ignore_ascii_case("oneof") {
        arg.nested.iter().map(render_arg).collect::<Vec<_>>().join("|")
    } else if arg.kind.eq_ignore_ascii_case("block") {
        arg.nested.iter().map(render_arg).collect::<Vec<_>>().join(" ")
    } else if arg.kind.eq_ignore_ascii_case("pure-token") {
        arg.token.clone().unwrap_or_else(|| arg.display.clone())
    } else if let Some(token) = &arg.token {
        if arg.display.is_empty() {
            token.clone()
        } else {
            format!("{token} {}", arg.display)
        }
    } else {
        arg.display.clone()
    };

    let with_multiple = if arg.multiple {
        format!("{core} [{core} ...]")
    } else {
        core
    };

    if arg.optional {
        format!("[{with_multiple}]")
    } else {
        with_multiple
    }
}

fn render_arg_list(args: &[RawArg]) -> String {
    args.iter().map(render_arg).collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use redis::Value;

    fn bulk(s: &str) -> Value {
        Value::BulkString(s.as_bytes().to_vec())
    }

    fn pairs_value(pairs: Vec<(&str, Value)>) -> Value {
        Value::Array(pairs.into_iter().flat_map(|(k, v)| [bulk(k), v]).collect())
    }

    #[test]
    fn parses_simple_command_with_positional_args() {
        let doc = pairs_value(vec![
            ("summary", bulk("获取字符串值")),
            ("since", bulk("1.0.0")),
            ("group", bulk("string")),
            (
                "arguments",
                Value::Array(vec![pairs_value(vec![("name", bulk("key")), ("type", bulk("key"))])]),
            ),
        ]);
        let reply = pairs_value(vec![("get", doc)]);
        let commands = parse_command_docs(&reply);
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "GET");
        assert_eq!(commands[0].arguments, "key");
    }

    #[test]
    fn renders_optional_token_and_oneof_arguments() {
        let ex_arg = pairs_value(vec![
            ("name", bulk("seconds")),
            ("type", bulk("integer")),
            ("token", bulk("EX")),
        ]);
        let px_arg = pairs_value(vec![
            ("name", bulk("milliseconds")),
            ("type", bulk("integer")),
            ("token", bulk("PX")),
        ]);
        let expiry = pairs_value(vec![
            ("type", bulk("oneof")),
            ("optional", Value::Int(1)),
            ("arguments", Value::Array(vec![ex_arg, px_arg])),
        ]);
        let key_arg = pairs_value(vec![("name", bulk("key")), ("type", bulk("key"))]);
        let value_arg = pairs_value(vec![("name", bulk("value")), ("type", bulk("string"))]);
        let doc = pairs_value(vec![
            ("summary", bulk("设置字符串值")),
            ("since", bulk("1.0.0")),
            ("group", bulk("string")),
            ("arguments", Value::Array(vec![key_arg, value_arg, expiry])),
        ]);
        let reply = pairs_value(vec![("set", doc)]);
        let commands = parse_command_docs(&reply);
        assert_eq!(commands[0].arguments, "key value [EX seconds|PX milliseconds]");
    }

    #[test]
    fn extracts_subcommand_short_name_and_own_arguments() {
        let get_sub = pairs_value(vec![
            ("summary", bulk("获取配置项")),
            (
                "arguments",
                Value::Array(vec![pairs_value(vec![
                    ("name", bulk("parameter")),
                    ("type", bulk("string")),
                    ("multiple", Value::Int(1)),
                ])]),
            ),
        ]);
        let subcommands = pairs_value(vec![("config|get", get_sub)]);
        let doc = pairs_value(vec![("summary", bulk("配置管理")), ("subcommands", subcommands)]);
        let reply = pairs_value(vec![("config", doc)]);
        let commands = parse_command_docs(&reply);
        assert_eq!(commands[0].subcommands.len(), 1);
        assert_eq!(commands[0].subcommands[0].name, "GET");
        assert_eq!(commands[0].subcommands[0].arguments, "parameter [parameter ...]");
    }

    #[test]
    fn ignores_malformed_entries_without_panicking() {
        let reply = Value::Array(vec![bulk("onlyonekey")]);
        assert_eq!(parse_command_docs(&reply).len(), 0);
    }
}
