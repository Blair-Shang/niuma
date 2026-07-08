# 插件 UI 入口（规划）

P1 起在此目录放置 ESM 入口，例如：

```ts
// ui/entry.ts
import type { ExtensionActivateFn } from '@/extensions/api'

export const activate: ExtensionActivateFn = async (context) => {
  // 注册 commands、订阅事件
}

export function deactivate() {}
```

构建产物 `ui/entry.js` 由 Shell 经 `app://plugins/<id>/ui/entry.js` 加载。

P0 阶段仅 manifest 示例，UI 尚未动态加载。
