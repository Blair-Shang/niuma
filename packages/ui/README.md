# @niuma/ui

NiuMa 设计系统组件库（`Rs*` 组件 + `--rs-*` token）。

从公共 UI 库迁入，供 `web/` 与插件 UI 共用。

```bash
pnpm --filter @niuma/ui dev    # Playground :5180
pnpm --filter @niuma/ui test
```

业务层：`import { RsButton } from '@niuma/ui'`，禁止 `import 'reka-ui'`。
