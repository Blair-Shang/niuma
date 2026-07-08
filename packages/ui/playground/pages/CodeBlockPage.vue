<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsCodeBlock } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

// ── 示例代码 ────────────────────────────────────────────────────────────────

const tsCode = `import { ref, computed, watch } from 'vue'

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
}`

const pythonCode = `from dataclasses import dataclass
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
        return resp.json()["choices"][0]["message"]["content"]`

const goCode = `package chatsvc

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
}`

const sqlCode = `-- 查询本月活跃用户与其消息数
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
LIMIT 20;`

const bashCode = `#!/usr/bin/env bash
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

echo "✓ 部署完成"`

const jsonCode = `{
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
}`

// ── 语言切换示例 ─────────────────────────────────────────────────────────────

const langs = [
  { key: 'typescript', label: 'TypeScript', code: tsCode },
  { key: 'python', label: 'Python', code: pythonCode },
  { key: 'go', label: 'Go', code: goCode },
  { key: 'sql', label: 'SQL', code: sqlCode },
  { key: 'bash', label: 'Bash', code: bashCode },
  { key: 'json', label: 'JSON', code: jsonCode },
] as const

type LangKey = (typeof langs)[number]['key']

const activeLang = ref<LangKey>('typescript')
const currentEntry = () => langs.find(l => l.key === activeLang.value)!

// ── 动态代码更新测试 ─────────────────────────────────────────────────────────

const liveLines = ref(3)
const liveCode = ref('const x = 1\nconst y = 2\nconst z = x + y')

function appendLine() {
  liveLines.value++
  liveCode.value += `\nconsole.log('line ${liveLines.value}')`
}
</script>

<template>
  <DemoPage title="RsCodeBlock" test-file="RsCodeBlock.spec.ts">

    <!-- ── 单语言展示 ── -->
    <DemoBlock title="TypeScript">
      <p class="hint">语法高亮、行号、只读；超过 32rem 内部滚动。</p>
      <RsCodeBlock :code="tsCode" lang="typescript" />
    </DemoBlock>

    <!-- ── 多语言切换 ── -->
    <DemoBlock title="语言切换">
      <p class="hint">
        支持 15+ 语言，动态 import 按需加载。
        切换 lang prop 后编辑器自动重建。
      </p>
      <div class="lang-tabs">
        <RsButton
          v-for="l in langs"
          :key="l.key"
          size="sm"
          :variant="activeLang === l.key ? 'primary' : 'default'"
          @click="activeLang = l.key"
        >
          {{ l.label }}
        </RsButton>
      </div>
      <RsCodeBlock :code="currentEntry().code" :lang="activeLang" />
    </DemoBlock>

    <!-- ── 各语言独立演示 ── -->
    <DemoBlock title="Python">
      <RsCodeBlock :code="pythonCode" lang="python" />
    </DemoBlock>

    <DemoBlock title="Go">
      <RsCodeBlock :code="goCode" lang="go" />
    </DemoBlock>

    <DemoBlock title="SQL">
      <RsCodeBlock :code="sqlCode" lang="sql" />
    </DemoBlock>

    <DemoBlock title="Bash / Shell">
      <RsCodeBlock :code="bashCode" lang="bash" />
    </DemoBlock>

    <DemoBlock title="JSON">
      <RsCodeBlock :code="jsonCode" lang="json" />
    </DemoBlock>

    <!-- ── 动态内容更新 ── -->
    <DemoBlock title="动态内容更新（code prop 变化）">
      <p class="hint">
        模拟流式结束后代码内容追加的场景；
        代码变化时编辑器文档同步更新，无需重建。
      </p>
      <div class="toolbar">
        <RsButton size="sm" @click="appendLine">+ 追加一行</RsButton>
        <span class="hint">共 {{ liveLines }} 行</span>
      </div>
      <RsCodeBlock :code="liveCode" lang="typescript" />
    </DemoBlock>

    <!-- ── 纯文本（无高亮） ── -->
    <DemoBlock title="text（无高亮）">
      <p class="hint">lang 未传或不识别时，展示纯文本，不报错。</p>
      <RsCodeBlock
        code="这是一段普通文本，没有语法高亮。
可以用来展示日志、配置摘要等。"
        lang="text"
      />
    </DemoBlock>

    <!-- ── 自定义复制文案 ── -->
    <DemoBlock title="自定义复制文案">
      <RsCodeBlock
        :code="jsonCode"
        lang="json"
        copy-label="Copy code"
        copied-label="Copied ✓"
      />
    </DemoBlock>

  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.lang-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-bottom: 0.75rem;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  margin-bottom: 0.75rem;
}
</style>
