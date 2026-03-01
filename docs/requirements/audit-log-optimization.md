# 需求文档：审计日志功能优化

**日期**：2026-03-01
**状态**：待开发（方案已确认）

---

## 背景

当前审计日志页面（`/audit-logs`）功能较为基础：
- 仅展示 6 列：操作人、动作、资源类型、资源ID（截断8位）、IP、时间
- 固定每页 20 条，仅支持翻页
- `diff`（变更详情）字段已存入数据库但未展示
- 无筛选/搜索功能
- 手动部署节点操作未被记录
- SSH 终端日志与审计日志完全分离，无法关联查看

---

## 需求确认过程

### 需求 1：筛选功能
**问**：希望支持哪些筛选维度？
**答**：动作类型（CREATE / UPDATE / DELETE / DEPLOY 等）

### 需求 2：变更详情（diff）展示
**问**：diff 如何展示？
**答**：展开行内查看（点击行左侧箭头，在行内显示格式化 JSON）

**追加讨论**：

> 用户提出：创建节点和删除节点日志中，希望包含 SSH 到服务器后终端显示的信息

**现状说明**：
- `AuditLog` 与 `OperationLog`（SSH 终端日志）是独立的两张表，没有关联
- CREATE / DELETE 的审计日志中 diff 为空，SSH 日志存在 `OperationLog` 里
- 手动部署（点击「部署」按钮）目前没有审计日志记录

**关联方案选择**：

| 方案 | 描述 | 精准度 |
|------|------|------|
| 方案 A（选定）| `OperationLog` 存 `correlationId`，与 `AuditLog` 精确关联 | ✅ 100% |
| 方案 B | 按时间推断最近的 OperationLog | ❌ 可能对应错 |

> 用户确认：选方案 A（精确关联）

> 用户确认：手动部署需要一起补录审计日志

### 需求 3：导出功能
**问**：是否需要导出？
**答**：不需要

### 需求 4：扩展性
**问**：日志系统希望有扩展性，以后增加的功能也能方便记录日志

**讨论了两个扩展方向**：

- **扩展性 A**：新功能加审计日志只需加一个装饰器，无需手写 `auditService.log()`
- **扩展性 B**：`OperationLog` 不局限于节点，任何 SSH 操作都能复用

> 用户确认：A + B 都要

---

## 最终确认需求

1. **动作类型筛选** — 审计日志页面支持按 action 类型过滤
2. **展开行 — diff 变更详情** — 格式化 JSON 展示（行内展开）
3. **展开行 — SSH 终端日志** — CREATE / UPDATE / DELETE / DEPLOY 行关联显示对应 SSH 日志
4. **手动部署补录审计日志** — 点击「部署」按钮记录 action=DEPLOY 的审计条目
5. **扩展性 A** — `@Audit()` 装饰器 + 拦截器，新 controller 方法加装饰器即可自动记录
6. **扩展性 B** — `OperationLog` 泛化为通用 SSH 操作日志，支持任意资源类型

---

## 实施方案

### Phase 0：Schema 重构

**OperationLog 泛化**（去掉节点专用字段，改为通用 resource 模型）：

```prisma
model OperationLog {
  id            String   @id @default(cuid())
  resourceType  String        // 'node' / 'server' / 未来任意资源
  resourceId    String?       // 可空 — 资源删除后日志仍保留
  resourceName  String        // 反范式化名称 — 资源删除后仍可显示
  actorId       String?
  operation     String        // 'DEPLOY' / 'UNDEPLOY' / 未来任意操作（String，不用改 enum）
  correlationId String?       // 关联 AuditLog
  success       Boolean
  log           String?
  durationMs    Int?
  createdAt     DateTime @default(now())

  @@index([resourceType, resourceId])
  @@index([correlationId])
  @@index([createdAt])
}
```

**AuditLog 加 correlationId**：

```prisma
model AuditLog {
  ...现有字段...
  correlationId String?

  @@index([correlationId])
}
```

删除 `OpType` 枚举（operation 改为 String）。

---

### Phase 1：@Audit 装饰器基础设施

新建文件：
- `common/decorators/audit.decorator.ts` — `@Audit(action, resource)` 装饰器
- `common/interceptors/audit.interceptor.ts` — 自动写审计日志的拦截器

```typescript
// 使用示例：未来新功能只需加一行
@Post()
@Audit('CREATE', 'node')
async create(@Body() dto: CreateNodeDto) { ... }
```

拦截器逻辑：
- 读取方法上的 `@Audit()` 元数据
- handler 返回后，自动从 response 取 `id`（CREATE）或路由参数取 `id`（UPDATE/DELETE）
- 生成 `correlationId`（UUID），注入 request context，写入 AuditLog
- SSE 流式接口**不走拦截器**，保留手动写入

将各 controller 现有手动 `auditService.log()` 替换为装饰器（AUTH 登录保留手动）。

---

### Phase 2：OperationLogService 泛化

更新 `CreateOperationLogParams`：

```typescript
interface CreateOperationLogParams {
  resourceType: string;    // 任意资源类型
  resourceId: string | null;
  resourceName: string;
  actorId: string | null;
  operation: string;       // 任意操作名（不限于 DEPLOY/UNDEPLOY）
  correlationId: string | null;
  success: boolean;
  log: string | null;
  durationMs: number | null;
}
```

新增查询方法：
- `listByResource(resourceType, resourceId)` — 按资源查历史
- `getByCorrelationId(correlationId)` — 供审计日志展开行使用
- `getLog(id)` — 获取单条完整日志文本

---

### Phase 3：correlationId 链路打通

**REST 接口（CREATE / UPDATE）**：
- 拦截器生成 `correlationId`，注入 request context
- controller 从 context 取值，传给异步 `deploy()`
- `deploy()` 写 OperationLog 时带上 `correlationId`

**SSE 接口（DEPLOY stream / DELETE stream）**：
- controller 手动生成 `correlationId`
- 写 AuditLog（带 `correlationId`）并传入流
- 写 OperationLog 时带上 `correlationId`

**手动部署补录**：
- `deployStream()` controller 新增写 AuditLog（action=DEPLOY）

---

### Phase 4：查询接口扩展

- `GET /audit-logs?action=CREATE` — 动作类型筛选
- `GET /operation-logs/by-correlation/:correlationId` — 审计日志展开行调用
- `GET /operation-logs/by-resource/:type/:id` — 资源历史日志
- `GET /operation-logs/:id/log` — 单条完整日志文本

OperationLog 相关接口从 `nodes.controller.ts` 移至独立的 `OperationLogController`。

---

### Phase 5：前端改造

**筛选栏**：Select 组件，8 种 action 类型带色 Tag，切换后重置 page=1

**展开行逻辑**：

| 条件 | 展示内容 |
|------|---------|
| `diff` 不为空 | 「变更详情」— 格式化 JSON（浅色背景） |
| resource=node 且 action 为 CREATE/UPDATE/DELETE/DEPLOY | 「SSH 日志」— 懒加载，深色终端样式 |
| 两者均有 | 两个区块同时显示 |
| 均无 | 「暂无详情」 |

只有满足条件的行显示展开箭头。

---

## 涉及文件

| 文件 | 类型 | 改动内容 |
|------|------|---------|
| `prisma/schema.prisma` | 修改 | OperationLog 泛化 + AuditLog 加 correlationId + 删除 OpType 枚举 |
| `common/decorators/audit.decorator.ts` | **新建** | @Audit 装饰器 |
| `common/interceptors/audit.interceptor.ts` | **新建** | 自动写审计日志拦截器 |
| `operation-log/operation-log.controller.ts` | **新建** | 独立 OperationLog 查询接口 |
| `operation-log/operation-log.service.ts` | 修改 | 泛化字段，新增查询方法 |
| `operation-log/operation-log.module.ts` | 修改 | 注册 Controller |
| `nodes/node-deploy.service.ts` | 修改 | 使用新字段名，传 correlationId |
| `nodes/nodes.controller.ts` | 修改 | 使用装饰器，SSE 手动写审计 + 补录 DEPLOY |
| `servers/servers.controller.ts` | 修改 | 替换为装饰器 |
| `templates/templates.controller.ts` | 修改 | 替换为装饰器 |
| `pipelines/pipelines.controller.ts` | 修改 | 替换为装饰器 |
| `audit/audit.service.ts` | 修改 | 加 action 过滤；确认返回 id |
| `audit/audit.controller.ts` | 修改 | 加 action 查询参数 |
| `web/src/lib/api.ts` | 修改 | 新增/修改接口 |
| `web/src/types/api.ts` | 修改 | 同步类型 |
| `web/src/app/(dashboard)/audit-logs/page.tsx` | 修改 | 筛选栏 + 展开行 |

---

## 风险说明

| 风险 | 等级 | 应对措施 |
|------|------|---------|
| 装饰器替换手动调用时双重记录 | 中 | 逐模块替换，替换后立即验证 |
| correlationId 在异步 deploy 中生命周期问题 | 中 | 提取值（非引用）后传入异步函数 |
| OperationLog 存量数据迁移 | 中 | migration 脚本补填 `resourceType: 'node'` |
| OperationLog 接口 URL 变更 | 低 | 前端 api.ts 同步更新 |
| SSE 接口不走拦截器的约定未来被遗忘 | 低 | 在拦截器代码注释中说明 |
| 登录审计日志保持手动（不适合装饰器） | 低 | Auth controller 不修改 |

---

## 不受影响的模块

- `Subscriptions` / `Metrics` / `Agent` / `Releases` — 无审计日志，不涉及
- `Auth`（登录/登出）— 保持手动写入，不改动
