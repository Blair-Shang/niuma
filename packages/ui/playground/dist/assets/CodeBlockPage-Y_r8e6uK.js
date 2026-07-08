import{$ as e,Mt as t,Ot as n,Pt as r,Tt as i,_t as a,bt as o,ft as s,ht as c,jt as l,mt as u,s as d,st as f,wt as p,xt as m,yt as h}from"./index-CrA0rARC.js";import{n as g,t as _}from"./DemoPage-Nwrrnwug.js";var v={class:`lang-tabs`},y={class:`toolbar`},b={class:`hint`},x=`import { ref, computed, watch } from 'vue'

interface User {
  id: string
  name: string
  role: 'admin' | 'member'
}

export function useUsers() {
  const users = ref<User[]>([])
  const loading = ref(false)

  const admins = computed(() =>
    users.value.filter(u => u.role === 'admin')
  )

  async function fetchUsers() {
    loading.value = true
    try {
      const res = await fetch('/api/users')
      users.value = await res.json()
    } finally {
      loading.value = false
    }
  }

  watch(users, (next) => {
    console.log('users changed:', next.length)
  })

  return { users, admins, loading, fetchUsers }
}`,S=`from dataclasses import dataclass
from typing import Optional
import httpx


@dataclass
class ModelConfig:
    name: str
    base_url: str
    api_key: str
    temperature: float = 0.7
    max_tokens: int = 4096


async def invoke_model(
    config: ModelConfig,
    prompt: str,
    system: Optional[str] = None,
) -> str:
    """调用 OpenAI-compatible 模型接口，返回生成文本。"""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{config.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {config.api_key}"},
            json={
                "model": config.name,
                "messages": messages,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]`,C=`package chatsvc

import (
	"context"
	"fmt"
	"strings"
)

// sanitizeMCPToolPart 将工具名中不符合 OpenAI function name 规范的字符
// 替换为下划线，确保 tools[].function.name 满足 ^[a-zA-Z0-9_-]+$ 约束。
func sanitizeMCPToolPart(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	return b.String()
}

// ExecuteRun 执行一次对话 Run：发送消息 → 流式返回 → 写入数据库。
func (s *Service) ExecuteRun(ctx context.Context, input ExecuteRunInput) error {
	conv, err := s.repo.GetConversation(ctx, input.ConversationID)
	if err != nil {
		return fmt.Errorf("chatsvc: get conversation: %w", err)
	}
	_ = conv
	// ... 实现省略
	return nil
}`,w=`-- 查询本月活跃用户与其消息数
SELECT
    u.id,
    u.name,
    u.email,
    COUNT(m.id)          AS message_count,
    MAX(m.created_at)    AS last_message_at,
    SUM(m.token_count)   AS total_tokens
FROM users u
INNER JOIN conversations c
    ON c.owner_id = u.id
    AND c.workspace_id = :workspace_id
INNER JOIN messages m
    ON m.conversation_id = c.id
    AND m.created_at >= DATE_TRUNC('month', NOW())
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.name, u.email
HAVING COUNT(m.id) > 0
ORDER BY message_count DESC
LIMIT 20;`,T=`#!/usr/bin/env bash
set -euo pipefail

# 部署弱水平台服务
REGISTRY="registry.example.com/ruoshui"
VERSION=\${1:-latest}
SERVICES=(server worker scheduler)

echo "==> 拉取镜像 (version: $VERSION)"
for svc in "\${SERVICES[@]}"; do
  docker pull "$REGISTRY/$svc:$VERSION"
done

echo "==> 滚动更新服务"
for svc in "\${SERVICES[@]}"; do
  docker service update \\
    --image "$REGISTRY/$svc:$VERSION" \\
    --update-parallelism 1 \\
    --update-delay 10s \\
    "ruoshui_$svc"
done

echo "==> 等待所有服务就绪…"
sleep 15
docker stack ps ruoshui --no-trunc

echo "✓ 部署完成"`,E=`{
  "name": "ruoshui-platform",
  "version": "1.0.0",
  "workspaces": ["apps/*", "packages/*", "services/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint"
  },
  "dependencies": {
    "turbo": "^2.0.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}`,D=f(m({__name:`CodeBlockPage`,setup(f){let m=[{key:`typescript`,label:`TypeScript`,code:x},{key:`python`,label:`Python`,code:S},{key:`go`,label:`Go`,code:C},{key:`sql`,label:`SQL`,code:w},{key:`bash`,label:`Bash`,code:T},{key:`json`,label:`JSON`,code:E}],D=l(`typescript`),O=()=>m.find(e=>e.key===D.value),k=l(3),A=l(`const x = 1
const y = 2
const z = x + y`);function j(){k.value++,A.value+=`\nconsole.log('line ${k.value}')`}return(l,f)=>(p(),c(_,{title:`RsCodeBlock`,"test-file":`RsCodeBlock.spec.ts`},{default:n(()=>[o(g,{title:`TypeScript`},{default:n(()=>[f[0]||=u(`p`,{class:`hint`},`语法高亮、行号、只读；超过 32rem 内部滚动。`,-1),o(t(d),{code:x,lang:`typescript`})]),_:1}),o(g,{title:`语言切换`},{default:n(()=>[f[1]||=u(`p`,{class:`hint`},` 支持 15+ 语言，动态 import 按需加载。 切换 lang prop 后编辑器自动重建。 `,-1),u(`div`,v,[(p(),a(s,null,i(m,i=>o(t(e),{key:i.key,size:`sm`,variant:D.value===i.key?`primary`:`default`,onClick:e=>D.value=i.key},{default:n(()=>[h(r(i.label),1)]),_:2},1032,[`variant`,`onClick`])),64))]),o(t(d),{code:O().code,lang:D.value},null,8,[`code`,`lang`])]),_:1}),o(g,{title:`Python`},{default:n(()=>[o(t(d),{code:S,lang:`python`})]),_:1}),o(g,{title:`Go`},{default:n(()=>[o(t(d),{code:C,lang:`go`})]),_:1}),o(g,{title:`SQL`},{default:n(()=>[o(t(d),{code:w,lang:`sql`})]),_:1}),o(g,{title:`Bash / Shell`},{default:n(()=>[o(t(d),{code:T,lang:`bash`})]),_:1}),o(g,{title:`JSON`},{default:n(()=>[o(t(d),{code:E,lang:`json`})]),_:1}),o(g,{title:`动态内容更新（code prop 变化）`},{default:n(()=>[f[3]||=u(`p`,{class:`hint`},` 模拟流式结束后代码内容追加的场景； 代码变化时编辑器文档同步更新，无需重建。 `,-1),u(`div`,y,[o(t(e),{size:`sm`,onClick:j},{default:n(()=>[...f[2]||=[h(`+ 追加一行`,-1)]]),_:1}),u(`span`,b,`共 `+r(k.value)+` 行`,1)]),o(t(d),{code:A.value,lang:`typescript`},null,8,[`code`])]),_:1}),o(g,{title:`text（无高亮）`},{default:n(()=>[f[4]||=u(`p`,{class:`hint`},`lang 未传或不识别时，展示纯文本，不报错。`,-1),o(t(d),{code:`这是一段普通文本，没有语法高亮。\r
可以用来展示日志、配置摘要等。`,lang:`text`})]),_:1}),o(g,{title:`自定义复制文案`},{default:n(()=>[o(t(d),{code:E,lang:`json`,"copy-label":`Copy code`,"copied-label":`Copied ✓`})]),_:1})]),_:1}))}}),[[`__scopeId`,`data-v-c40c148a`]]);export{D as default};