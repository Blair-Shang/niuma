# 07 — Web 层总览

> 版本：v0.1 · 日期：2026-07-03  
> Layer 4：CEF Renderer 内运行的 Vue 3 前端

---

## 1. 定位

Web 层是 NiuMa 桌面 App 的 **UI 渲染进程**，运行在 CEF Chromium 内，通过 **CEF IPC**（cefQuery / PostMessage）与 C++ 壳通信，**不直连**后端服务。

职责划分：

| 文档 | 内容 |
|------|------|
| [08-web-design-system.md](./08-web-design-system.md) | 视觉 token、组件库、交互规范（**不含布局**） |
| [09-web-app-shell.md](./09-web-app-shell.md) | App Shell 布局、路由、模块挂载（**不含视觉细节**） |

---

## 2. 技术栈

| 使用 | 禁止 |
|------|------|
| **Vue 3** + **TypeScript** + **Vite** | Element Plus、Ant Design Vue |
| **Tailwind CSS v4**、`web/src/styles/tokens.css` | 内联混乱 class、随意硬编码色值 |
| **Reka UI**（`reka-ui`，仅 `packages/ui` 内） | 业务层自建 Dialog/Menu 焦点陷阱 |
| **lucide-vue-next**、**vue-sonner** | `ElMessage`、Ant `message` |
| **Pinia** | 无规范的全局 `ref` 散落 |
| **vue-i18n** | 组件内硬编码中英文 |

### 2.1 依赖边界

```
web/（业务）
  ├── import @niuma/ui          ✅
  ├── import pinia / vue-i18n   ✅
  └── import reka-ui            ❌ 禁止

packages/ui/（组件库）
  ├── reka-ui                   ✅ 内部底层
  └── 对外只暴露 Rs* + composables
```

---

## 3. 目录结构（规划）

```
NiuMa/
├── packages/
│   └── ui/                      # @niuma/ui — 公共组件库（见 §4）
├── web/                         # CEF 内主 Web 应用
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.ts
│       ├── App.vue
│       ├── app/                 # 入口配置、Provider 挂载
│       ├── shell/               # App Shell 布局（见 09）
│       ├── modules/             # 可插拔业务模块 UI
│       │   ├── ssh/
│       │   ├── database/
│       │   ├── api-tester/
│       │   └── ai/
│       ├── stores/              # Pinia stores
│       ├── composables/         # 业务 composables（含 bridge）
│       ├── locale/              # vue-i18n 业务文案
│       ├── router/
│       └── styles/
│           ├── tokens.css       # Tailwind v4 + 业务扩展 token
│           └── brand.css        # NiuMa 品牌色覆盖
└── ...
```

---

## 4. 公共组件库 `@niuma/ui`

### 4.1 来源与迁入

将已有组件库 **整包复制** 到本仓库：

```
源：E:\shangijan\AI\RuoShui\packages\ui
目标：NiuMa/packages/ui
```

迁入后修改：

| 项 | 原值 | 改为 |
|----|------|------|
| `package.json` name | `@ruoshui/ui` | `@niuma/ui` |
| 文档/README | 原项目名 | NiuMa |
| 其余实现 | — | **暂保留** `Rs*` 组件名与 `--rs-*` token（减少迁移成本） |

> 组件前缀 `Rs*` 与 CSS 变量 `--rs-*` 为组件库内部命名，与 NiuMa 产品名不冲突；业务文档与 UI 对外称 **NiuMa 设计系统**。

### 4.2 组件清单（迁入后可用）

| 分类 | 组件 |
|------|------|
| 基础 | `RsButton` `RsInput` `RsLabel` `RsIcon` `RsLink` `RsBadge` |
| 表单 | `RsForm` `RsSelect` `RsDatePicker` `RsTimePicker` `RsUpload` |
| 导航 | `RsBreadcrumb` `RsMenu` `RsTabs` `RsSidebar` `RsSteps` |
| 反馈 | `RsDialog` `RsDrawer` `RsPopover` `RsTooltip` `RsToaster` `RsConfirmDialog` |
| 数据 | `RsTable` `RsTree` `RsPagination` `RsVirtualList` `RsStatCard` |
| 代码 | `RsCodeEditor` `RsCodeBlock` `RsProseEditor` |
| 布局辅助 | `RsContainer` `RsCard` `RsScrollbar` `RsEmpty` `RsLoading` |
| 全局 | `RsConfigProvider` |

完整 export 见 `packages/ui/src/index.ts`。

### 4.3 业务接入

```vue
<!-- web/src/App.vue -->
<script setup lang="ts">
import { RsConfigProvider } from '@niuma/ui'
import '@niuma/ui/styles.css'
import '@/styles/brand.css'
</script>

<template>
  <RsConfigProvider theme="dark" locale="zh-CN">
    <AppShell />
  </RsConfigProvider>
</template>
```

```css
/* web/src/styles/brand.css — 在 styles.css 之后 */
[data-rs-theme='light'] {
  --rs-primary: #4f46e5;
  --rs-primary-hover: #4338ca;
}
[data-rs-theme='dark'] {
  --rs-primary: #818cf8;
  --rs-primary-hover: #a5b4fc;
}
```

### 4.4 Playground 与测试

```bash
pnpm --filter @niuma/ui dev      # Playground，默认 :5180
pnpm --filter @niuma/ui test     # Vitest 组件测试
```

---

## 5. Pinia 状态划分

| Store | 职责 |
|-------|------|
| `useAppStore` | 主题、语言、窗口状态、全局 loading |
| `useBridgeStore` | CEF IPC 请求封装、事件订阅 |
| `useConnectionStore` | SSH/DB/FTP 连接 profile 列表（读 Platform） |
| `useModuleStore` | 已注册插件、当前激活模块 |
| `useAiStore` | AI 对话会话、Provider 配置 |
| `useTabStore` | 工作区 Tab（多会话） |

原则：

- **服务端数据**经 Bridge → Platform IPC 拉取，Pinia 做缓存与 UI 状态
- **凭据明文不进 Pinia**；仅存 `credential_id` / `profile_id`
- 模块级状态放 `modules/*/stores/`，全局才进 `web/src/stores/`

---

## 6. vue-i18n 分层

| 层 | 位置 | 内容 |
|----|------|------|
| 组件库 | `packages/ui/src/locale/messages.ts` | `Rs*` 内置文案（`useRsI18n` / `useRsConfig().t`） |
| 业务壳 | `web/src/locale/zh-CN.ts` `en-US.ts` | 模块名、菜单、业务提示 |
| 插件 | `modules/*/locale/` | 插件自有文案（可选） |

`RsConfigProvider` 的 `locale` 与 `vue-i18n` 应用 locale **保持同步**。

---

## 7. CEF Bridge 接入（Web 侧）

```ts
// web/src/composables/useNiumaBridge.ts
export function useNiumaBridge() {
  async function invoke<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      window.cefQuery?.({
        request: JSON.stringify({ method, params, id: crypto.randomUUID() }),
        onSuccess: (res) => resolve(JSON.parse(res)),
        onFailure: (code, msg) => reject(new Error(msg)),
      })
    })
  }

  function onEvent(handler: (detail: unknown) => void) {
    window.addEventListener('niuma:event', (e) => handler((e as CustomEvent).detail))
  }

  return { invoke, onEvent }
}
```

流式输出（SSH、AI）通过 `onEvent` 订阅，见 [03-ipc-protocol.md](./03-ipc-protocol.md)（待补充）。

---

## 8. 开发命令（规划）

```bash
pnpm install
pnpm --filter @niuma/ui dev     # 组件 Playground
pnpm --filter web dev           # Web 应用，:5173
```

CEF 联调：壳加载 `app://niuma/index.html`，指向 Vite build 产物或 dev server（开发期配置）。

---

## 9. 相关文档

- [08 — UI 设计规范（视觉/组件）](./08-web-design-system.md)
- [09 — App Shell 布局](./09-web-app-shell.md)
- [01 — 总体架构](./01-architecture-overview.md)
