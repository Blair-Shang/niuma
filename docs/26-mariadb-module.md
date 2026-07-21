# 26 — MariaDB 管理模块（独立 Layer-1；与 MySQL 分立）

> 版本：v0.1 · 日期：2026-07-20  
> 状态：**占位设计稿（服务未实现）** — 明确与 MySQL **分进程、分 kind**，避免差异越积越大后无法拆分  
> **禁止**并入 [25 — MySQL](./25-mysql-module.md) / `mysql-service`

> 关联：[14](./14-capability-connection-framework.md) · [21](./21-session-registry.md) · [23](./23-sql-dialect-completion.md) · [25 — MySQL](./25-mysql-module.md)（边界对照，非实现依赖）

---

## 0. 为何独立

MariaDB 与 Oracle MySQL 虽同属「类 MySQL 协议」家族，但在认证、系统库、函数/过程、优化器提示、版本节奏上持续分叉。合并进单一 `mysql-service` 会导致：

- Cap 表与 Probe 出现 `if mariadb` 双轨，长期无法维护  
- 连接 kind 混淆，用户连错引擎却「半好用」  
- Web/AI 规则纠缠，回归成本高

因此：**MariaDB = 独立能力服务 + 独立 ConnKind**；MySQL 服务只消化 **MySQL 自身版本**（见 [25](./25-mysql-module.md)）。

---

## 1. 关键决策（P0 骨架）

| 维度 | 决策 |
|------|------|
| 能力服务 | Layer-1 **`mariadb-service`**（二进制建议 `niuma-mariadb-service`） |
| 协议 kind | **`mariadb`** |
| Bridge namespace | **`mariadb`**（`mariadb.session.open` 等） |
| Dialect `family` | **`"mariadb"`** |
| Cap 前缀 | **`mariadb.*`**（及本模块自有 `routine.*` / `format.*` 等，**不复用** `mysql.*` 默认集作「伪装」） |
| Web 模块 | `web/src/modules/mariadb/`（独立注册；可复用 sql-editor 编排） |
| 与 MySQL 关系 | 可同源参考实现（fork 起步），但 **禁止运行时调用 mysql-service**；禁止共享同一进程内双引擎分支 |

共享契约（方法名 / CatalogCache / session-registry）仍走 [23](./23-sql-dialect-completion.md) / [21](./21-session-registry.md)；**对象语义与 Cap 表写在本文落地版**，不写进 25。

---

## 2. 与 MySQL 的互操作约定

| 场景 | 行为 |
|------|------|
| 用户用 **MySQL** kind 连到 MariaDB 实例 | `mysql-service` Probe **拒绝**（见 25 §2.2） |
| 用户用 **MariaDB** kind 连到 Oracle MySQL 实例 | 本服务 Probe **拒绝**，提示改用 MySQL 连接类型 |
| 产品表单 | 连接类型分两项：**MySQL** / **MariaDB**，不可混选「自动探测后合并服务」 |

---

## 3. 分期（占位）

| Phase | 内容 |
|-------|------|
| **文档** | 本稿边界 + 与 25 互斥约定（当前） |
| **P0** | 服务骨架、manifest、`session.*`、Probe、最小 Query（对齐 25 的分期节奏，**独立排期**） |
| **P1+** | tree / catalog / meta / routines — 按 MariaDB 版本矩阵单独建 Cap 表 |

详细 Bridge / ConnectParams / ResourceId 在 P0 开工前扩写本稿，**不要**从 25 整篇复制后改几个词而不改 kind/family。

---

## 4. 红线

1. **禁止**把 MariaDB 逻辑合进 `mysql-service` 或 `modules/mysql`。  
2. **禁止** `family: "mysql"` 冒充 MariaDB 会话。  
3. **禁止** platform 为「省事」把两种 kind 代理到同一可执行文件且用内部 if 分流（若二进制复用构建，仍须 **两个 manifest / 两个 namespace / 两套入口** 或明确双模式隔离——默认推荐 **两个独立二进制**）。

---

## 5. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-20 | 占位：与 MySQL 分服务 / 分 kind；互斥 Probe；避免差异合流 |
