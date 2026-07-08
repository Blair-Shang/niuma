# 08 — Web UI 设计规范

> 版本：v0.1 · 日期：2026-07-03  
> **本文只约束视觉与组件用法，不涉及 App Shell 布局**（布局见 [09-web-app-shell.md](./09-web-app-shell.md)）

---

## 1. 设计定位

整体气质：**精密、轻盈、有未来感** — 色板对齐 macOS system colors，交互参考 Linear / Raycast，而非传统政企后台。

| 关键词 | 落地 |
|--------|------|
| **精密** | 4px 网格、对齐严格、信息层级清晰 |
| **轻盈** | 大留白、单层轻阴影、细描边 |
| **科技** | macOS 冷中性灰阶 + systemBlue、等宽字体用于代码/终端 |
| **潮流** | 半透明面板、微 blur、品牌色 8–12% 激活底 |
| **可信** | WCAG 2.1 AA，不牺牲可用性 |

### 参考谱系

| 来源 | 吸收 | NiuMa 落地 |
|------|------|------------|
| macOS HIG | systemBlue / label / groupedBackground | 明暗色板、输入框描边、功能色 |
| Linear / Vercel | 暗色分层、半透明描边 | `surface` 栈、导航激活态 |
| Raycast / Arc | 命令面板、紧凑工具栏 | ghost 按钮、快捷键提示 |
| Tabby / WindTerm | 终端区域 | `RsCodeBlock`、xterm 容器样式 |
| Stripe | 数据卡片 | `RsStatCard`、表格密度 |

> Ant Design **仅作**高密度表格结构参考，**禁止**引入其组件库与视觉风格。

---

## 2. 技术约束

| 使用 | 禁止 |
|------|------|
| `@niuma/ui` 的 `Rs*` 组件 | Element Plus、Ant Design Vue |
| `var(--rs-*)` design token | 硬编码 `#hex`、`rgb()` |
| Tailwind v4 工具类（语义化组合） | 超长内联 class 字符串 |
| `lucide-vue-next` 图标 | Element 图标集 |
| `vue-sonner`（经 `RsToaster`） | `ElMessage` |
| Reka UI（**仅** `packages/ui` 内部） | 业务层 `import 'reka-ui'` |

### 组件封装原则

```
Reka UI（无障碍/键盘/焦点）
    ↓ 仅在 packages/ui 内
Rs* 组件（样式 100% token 驱动）
    ↓ 业务只 import @niuma/ui
web/、modules/
```

---

## 3. 颜色与 Token

**权威来源**：`packages/ui/src/styles.css` 中的 `[data-rs-theme]`。

禁止在业务代码硬编码颜色；只读 CSS 变量：

| 类别 | Token 示例 |
|------|------------|
| 品牌 | `--rs-primary` `--rs-primary-hover` |
| 背景 | `--rs-bg` `--rs-surface` `--rs-surface-elevated` |
| 文字 | `--rs-text` `--rs-muted` `--rs-placeholder` |
| 描边 | `--rs-border` `--rs-border-subtle` |
| 功能 | `--rs-success` `--rs-warning` `--rs-danger` `--rs-info` |
| 容器 | `--rs-primary-container` `--rs-on-primary-container` |
| 交互 | `--rs-item-hover` `--rs-focus-border` `--rs-focus-ring` `--rs-focus-ring-width` |

### 主题切换

- JS **只切换** `data-rs-theme="light|dark"`，不改 token 定义
- 使用 `RsConfigProvider` 或 `applyTheme()` / `setTheme()`
- NiuMa 品牌覆盖：`web/src/styles/brand.css` 覆盖 `--rs-primary*`（在 `styles.css` **之后** import）

### 亮色 / 暗色基准（macOS system）

| Token | 亮色 | 暗色 |
|-------|------|------|
| `primary` | `#007AFF`（systemBlue） | `#0A84FF` |
| `bg` | `#F5F5F7` | `#1C1C1E` |
| `surface` | `#FFFFFF` | `#2C2C2E` |
| `surface-elevated` | `#FFFFFF` | `#3A3A3C` |
| `text` | `#1D1D1F` | 98% white |
| `muted` | `rgb(60 60 67 / 0.6)` | `rgb(235 235 245 / 0.6)` |
| `danger` / `success` | `#FF3B30` / `#34C759` | `#FF453A` / `#30D158` |

---

## 4. 尺寸与排版

| Token | 值 | 用途 |
|-------|-----|------|
| 控件高度 sm/md/lg | 24 / 32 / 40px | 工具栏 sm，表单 md |
| 字号 xs~lg | 12 / 14 / 16 / 18px | 辅助 ~ 页标题 |
| 间距 | 4px 网格 | 区块间优先 `--rs-space-xl` |
| 圆角 | `--rs-radius-sm` ~ `--rs-radius` | 8–12px；主按钮可 pill |

**字体栈**

- 界面：`Inter, "SF Pro Text", -apple-system, "Segoe UI", "PingFang SC", sans-serif`
- 代码/终端/ID：`ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace`

字重：标题 600 · 正文 400 · 标签 500 + `muted`

---

## 5. 组件用法规范

### 5.1 按钮

| variant | 场景 |
|---------|------|
| `primary` | 主 CTA（连接、保存、执行） |
| `default` | 次要操作 |
| `ghost` | 工具栏、表格行内 |

### 5.2 表单

- 统一 `RsForm` + `RsLabel` + `RsInput` / `RsSelect`
- 校验错误：`danger` 色 + 文案，不仅靠颜色
- 禁止混用原生 `<select>`、浏览器 `alert`

### 5.3 表格

- 运维列表用 `RsTable` + `RsVirtualList`（大结果集）
- 行 hover：`item-hover`；选中：`primary` 12% 混合底

### 5.4 代码与终端

- SQL / 脚本编辑：`RsCodeEditor`
- 只读输出 / 日志：`RsCodeBlock`
- SSH 终端（xterm.js）：容器使用 `--rs-surface-elevated` + 等宽字体 + 细描边

### 5.5 反馈

- 轻提示：`useRsToast()` / `RsToaster`
- 确认危险操作：`RsConfirmDialog`（SSH 执行、删库等）
- 禁止 `window.alert`

---

## 6. 阴影、动效、深度

- **亮色**：单层轻阴影，hover 微抬升
- **暗色**：靠 `surface` 分层 + 1px 发丝描边，阴影极轻
- **玻璃面板**（Popover、Dropdown）：`backdrop-filter: blur(12px)` + `border-subtle`
- **动效**：`150–200ms` `cubic-bezier(0.4, 0, 0.2, 1)`；尊重 `prefers-reduced-motion`
- **Z-index**：`--rs-z-tooltip:10` · `dropdown:50` · `modal:100` · `toast:200`

---

## 7. 无障碍

```css
/* 克制聚焦：沉一点的描边 + 低透明 2px 外环，避免高饱和蓝光晕 */
:focus-visible {
  outline: none;
  border-color: var(--rs-focus-border, var(--rs-primary));
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
```

- 图标按钮必须 `aria-label`（走 i18n）
- 触控目标 ≥ 44px（桌面仍保证键盘可达）
- 状态不只靠颜色（配图标/文案）
- 禁用态 `opacity: 0.38`

---

## 8. 多语言（强制）

**所有 `Rs*` 内置文案必须 i18n**，禁止硬编码中文或英文。

| 机制 | 说明 |
|------|------|
| `packages/ui/src/locale/messages.ts` | 组件库 zh-CN / en-US |
| `useRsI18n()` / `useRsConfig().t` | 组件内翻译 |
| `RsConfigProvider locale` | 与 `vue-i18n` 同步 |
| 业务文案 | `web/src/locale/`，组件不翻译业务数据 |

新增文案 checklist：

1. `messages.ts` 双语同时添加
2. Playground 可切换语言目测
3. 单测覆盖 locale 切换

---

## 9. 插件模块 UI 约束

可插拔模块（`web/src/modules/*`）必须：

1. **只使用** `@niuma/ui` 组件与 `--rs-*` token
2. **禁止**自带 Element/Ant 或第二套 CSS 框架
3. **禁止** `import 'reka-ui'`
4. 模块 UI 由 Shell 的工作区挂载，不改变全局 token 定义

---

## 10. 反模式

- Ant 式挤满边框、高饱和功能色大块
- 纯 `#000` / `#fff` 硬编码
- `z-index: 9999`
- 整页渐变 Hero
- 霓虹赛博风大面积铺色
- 国内传统后台风套用到 AI 工具产品
- 插件引入独立 UI 库

---

## 11. 检查清单

1. 是否只 import `@niuma/ui`，未引入 Element/Ant？
2. 颜色是否全部 `var(--rs-*)`？
3. 双主题（light/dark）目测是否像 Linear/Vercel 工具风？
4. 危险操作是否有 `RsConfirmDialog`？
5. `Rs*` 新增文案是否双语？
6. 终端/代码区是否等宽 + `surface-elevated`？
7. 是否未在业务层 import `reka-ui`？

---

## 12. 相关文档

- [07 — Web 总览](./07-web-overview.md)
- [09 — App Shell 布局](./09-web-app-shell.md)（布局不在本文范围）
