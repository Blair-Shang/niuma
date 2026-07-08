# SQL 迁移脚本

SQLite 迁移源文件，规范见 [docs/database-schema.md](../docs/database-schema.md)。

```
scripts/sql/
└── sqlite/
    ├── 000000_schema.up.sql / .down.sql
    ├── 000001_core.up.sql / .down.sql
    └── 000002_connection.up.sql / .down.sql
```

## 约定

- 命名：`{6位版本}_{域}.up.sql` / `.down.sql`
- **物理删除**，无 `is_deleted`
- 表前缀 `nm_`

## 打包分发

`scripts/platforms/windows/pack/bundle-windows.ps1` 会将本目录复制到发布包：

```
pack/win-x64/platform/migrations/sqlite/
```

Platform Core 启动时对用户库 `%LOCALAPPDATA%\NiuMa\data\niuma.db` 执行 migrate。
