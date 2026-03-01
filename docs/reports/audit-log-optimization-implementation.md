# 实施报告：审计日志功能优化

**日期**：2026-03-02
**状态**：已完成（5个阶段全部交付）

---

## 概述

本次实施基于 `docs/requirements/audit-log-optimization.md` 中的确认需求，完成了以下工作：

- **Phase 0**：数据库 Schema 重构（已在前置会话完成）
- **Phase 1**：`@Audit` 装饰器 + `AuditInterceptor` 全局拦截器
- **Phase 2**：`OperationLogService` 泛化（支持任意资源类型）
- **Phase 3**：`correlationId` 链路打通 + 手动部署补录审计日志
- **Phase 4**：查询接口扩展 + 审计日志 action 筛选
- **Phase 5**：前端审计日志页面改造

---

## Phase 0 — Schema 重构（前置完成）

### OperationLog 泛化

去掉节点专用字段，改为通用 resource 模型：

| 旧字段 | 新字段 | 说明 |
|--------|--------|------|
| `nodeId String?` | `resourceId String?` | 可空，资源删除后日志仍保留 |
| `nodeName String` | `resourceName String` | 反范式化，资源删除后仍可显示名称 |
| 无 | `resourceType String` | 资源类型，如 'node'、'server' |
| `operation OpType`（枚举） | `operation String` | 改为字符串，不再受限于枚举 |
| 无 | `correlationId String?` | 关联 AuditLog |

删除 `OpType` 枚举（DEPLOY \| UNDEPLOY）。

### AuditLog 新增字段

```prisma
correlationId String?   // 关联 OperationLog
@@index([correlationId])
```

### 迁移说明

由于 Prisma 无法自动处理列重命名和枚举→TEXT 类型变更，采用手动迁移 SQL：

```sql
ALTER TABLE "OperationLog" RENAME COLUMN "nodeId" TO "resourceId";
ALTER TABLE "OperationLog" RENAME COLUMN "nodeName" TO "resourceName";
ALTER TABLE "OperationLog" ADD COLUMN "resourceType" TEXT NOT NULL DEFAULT 'node';
ALTER TABLE "OperationLog" ALTER COLUMN "resourceType" DROP DEFAULT;
ALTER TABLE "OperationLog" ALTER COLUMN "operation" TYPE TEXT USING "operation"::TEXT;
ALTER TABLE "OperationLog" ADD COLUMN "correlationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;
DROP TYPE IF EXISTS "OpType";
```

存量数据通过 `DEFAULT 'node'` 自动回填 `resourceType`。

---

## Phase 1 — `@Audit` 装饰器 + AuditInterceptor

### 新建文件

**`common/decorators/audit.decorator.ts`**

```typescript
export const Audit = (action: AuditAction, resource: string): MethodDecorator =>
  SetMetadata(AUDIT_KEY, { action, resource });
```

**`common/interceptors/audit.interceptor.ts`**

全局拦截器工作流程：

1. 在 handler 执行**前**生成 `correlationId`（UUID），存入 `req.correlationId`
2. Handler 执行期间，controller 可从 `req.correlationId` 读取值，传给异步操作
3. Handler 返回后，通过 `rxjs tap` 自动写入 `AuditLog`：
   - `resourceId`：优先取 response.id（CREATE），否则取路由参数 `:id`
   - `diff`：取请求 body（非空时）
   - `correlationId`：步骤 1 生成的值

**注意**：SSE 流式接口（返回 Observable）**不经过** tap，必须在 controller 中手动写入 AuditLog。此约定在拦截器代码注释中有说明。

### 全局注册

```typescript
// app.module.ts
providers: [
  { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
]
```

### 使用示例

```typescript
@Post()
@Roles('ADMIN', 'OPERATOR')
@Audit('CREATE', 'node')
create(@Body() dto: CreateNodeDto) {
  return this.nodesService.create(dto);  // 无需手动调用 auditService.log()
}
```

---

## Phase 2 — OperationLogService 泛化

### 更新：`operation-log.service.ts`

新接口定义：

```typescript
interface CreateOperationLogParams {
  resourceType: string;
  resourceId: string | null;
  resourceName: string;
  actorId: string | null;
  operation: string;
  correlationId: string | null;
  success: boolean;
  log: string | null;
  durationMs: number | null;
}
```

新增查询方法：

| 方法 | 说明 |
|------|------|
| `listByResource(type, id, limit)` | 按资源类型+ID 查历史（替换原 `listByNode`） |
| `getByCorrelationId(correlationId)` | 通过 correlationId 查关联日志（含 log 全文） |
| `getLog(id)` | 获取单条完整日志文本 |

### 新建：`operation-log.controller.ts`

独立的 OperationLog 查询接口，从 `nodes.controller.ts` 剥离：

| 路由 | 说明 |
|------|------|
| `GET /operation-logs/by-resource/:type/:id` | 资源历史日志 |
| `GET /operation-logs/by-correlation/:correlationId` | 审计日志展开行调用 |
| `GET /operation-logs/:id` | 完整日志详情 |

---

## Phase 3 — correlationId 链路打通

### node-deploy.service.ts

所有 `finalize()` 和 `doUndeployWithLogs()` 调用均新增 `correlationId?` 参数，写入 OperationLog 时携带：

```typescript
await this.operationLog.createLog({
  resourceType: 'node',
  resourceId: nodeId,
  resourceName: nodeName,
  correlationId: correlationId ?? null,
  // ...
});
```

### nodes.controller.ts（SSE 接口手动处理）

```typescript
@Sse(':id/deploy-stream')
deployStream(@Param('id') id: string, @CurrentUser() user: { id: string }) {
  const correlationId = randomUUID();
  // SSE 不走拦截器 — 手动写入 AuditLog
  void this.auditService.log({ actorId: user.id, action: 'DEPLOY', resource: 'node', resourceId: id, correlationId });
  return this.nodeDeploy.deployStream(id, user.id, correlationId);
}
```

### 手动部署补录

`POST /nodes/:id/deploy-stream` 新增写入 `action=DEPLOY` 的审计日志，此前该接口无任何审计记录。

### 各 controller 迁移

| Controller | 改动 |
|-----------|------|
| `servers.controller.ts` | 所有手动 `auditService.log()` → `@Audit()` 装饰器；移除 `AuditService` 直接注入 |
| `templates.controller.ts` | 同上 |
| `pipelines.controller.ts` | 新增 CREATE/UPDATE/DELETE 的 `@Audit()` 装饰器（原无审计） |
| `nodes.controller.ts` | 非 SSE 接口改用装饰器；SSE 接口保留手动 + correlationId |

---

## Phase 4 — 查询接口扩展

### audit.service.ts

```typescript
interface LogParams {
  // ...
  correlationId?: string;  // 新增
}

async findAll(page = 1, pageSize = 20, action?: AuditAction) {
  const where = action ? { action } : {};
  // ...
}
```

### audit.controller.ts

```typescript
@Get()
findAll(
  @Query('page') page = 1,
  @Query('pageSize') pageSize = 20,
  @Query('action') action?: AuditAction,  // 新增
) {
  return this.auditService.findAll(+page, +pageSize, action);
}
```

---

## Phase 5 — 前端审计日志页面改造

### 筛选栏

Select 组件，支持 8 种 action 类型过滤（CREATE / UPDATE / DELETE / LOGIN / LOGOUT / DEPLOY / ROLLBACK / SSH_TEST），切换后自动重置 page=1。

### 展开行逻辑

| 条件 | 展示内容 |
|------|---------|
| `diff` 不为空 | 「变更详情」— 格式化 JSON，浅色背景 (`#f6f8fa`) |
| `resource=node` 且 action 为 CREATE/UPDATE/DELETE/DEPLOY | 「SSH 执行日志」— 懒加载，深色终端样式 (`#0d1117`) |
| 两者均有 | 两个区块同时显示 |
| 均无 | 只有满足条件的行显示展开箭头 |

SSH 日志通过 `GET /operation-logs/by-correlation/:correlationId` 懒加载，使用 TanStack Query 缓存（`staleTime: 60s`）。

### 前端 API 更新

```typescript
// api.ts
export const auditApi = {
  list: (page, pageSize, action?) => api.get('/audit-logs', { params: { page, pageSize, action } }),
};

export const operationLogsApi = {
  listByResource: (type, id) => api.get(`/operation-logs/by-resource/${type}/${id}`),
  getByCorrelationId: (correlationId) => api.get(`/operation-logs/by-correlation/${correlationId}`),
  getLog: (logId) => api.get(`/operation-logs/${logId}`),
};
```

### DeployLogModal 更新

- `nodesApi.operationLogs(id)` → `operationLogsApi.listByResource('node', id)`
- `nodesApi.operationLog(logId)` → `operationLogsApi.getLog(logId)`
- `operation` 显示支持任意字符串（不再硬编码 DEPLOY/UNDEPLOY）

---

## 涉及文件清单

### 后端（新建）

| 文件 | 说明 |
|------|------|
| `common/decorators/audit.decorator.ts` | `@Audit` 元数据装饰器 |
| `common/interceptors/audit.interceptor.ts` | 全局审计拦截器 |
| `operation-log/operation-log.controller.ts` | 独立 OperationLog 查询接口 |

### 后端（修改）

| 文件 | 改动内容 |
|------|---------|
| `operation-log/operation-log.service.ts` | 泛化字段；新增 listByResource、getByCorrelationId |
| `operation-log/operation-log.module.ts` | 注册 OperationLogController |
| `audit/audit.service.ts` | 加 correlationId；findAll 支持 action 过滤 |
| `audit/audit.controller.ts` | 加 `?action=` 查询参数 |
| `nodes/node-deploy.service.ts` | 使用新字段名；传递 correlationId |
| `nodes/nodes.controller.ts` | 非 SSE 用装饰器；SSE 手动写审计 + 补录 DEPLOY |
| `servers/servers.controller.ts` | 全部改用 `@Audit()` 装饰器，移除直接注入 AuditService |
| `servers/servers.module.ts` | 移除不再需要的 AuditModule 导入 |
| `templates/templates.controller.ts` | 全部改用 `@Audit()` 装饰器 |
| `templates/templates.module.ts` | 移除不再需要的 AuditModule 导入 |
| `pipelines/pipelines.controller.ts` | 新增 CREATE/UPDATE/DELETE `@Audit()` |
| `app.module.ts` | 注册 APP_INTERCEPTOR + OperationLogModule |

### 前端（修改）

| 文件 | 改动内容 |
|------|---------|
| `src/lib/api.ts` | 新增 operationLogsApi；auditApi.list 支持 action 参数 |
| `src/types/api.ts` | AuditLog 加 correlationId；OperationLogEntry 更新为新字段名 |
| `src/app/(dashboard)/audit-logs/page.tsx` | 全量重写：筛选栏 + 展开行 |
| `src/components/nodes/DeployLogModal.tsx` | 改用 operationLogsApi 新端点 |

---

## 验证结果

```
✓ apps/server pnpm build — 编译成功，零 TypeScript 错误
✓ apps/web pnpm build    — 编译成功，零 TypeScript 错误，11个页面静态生成
```

---

## 风险落地情况

| 风险 | 处置结果 |
|------|---------|
| 装饰器替换手动调用时双重记录 | 逐 controller 替换，旧代码完全删除，无双重记录 |
| correlationId 在异步 deploy 中生命周期问题 | 拦截器将值写入 req 字段，controller 提取为基本类型后传入异步函数 |
| OperationLog 存量数据迁移 | 通过 SQL `DEFAULT 'node'` 自动回填 `resourceType` |
| OperationLog 接口 URL 变更 | 前端 api.ts 同步更新，DeployLogModal 同步更新 |
| SSE 接口不走拦截器约定被遗忘 | 在拦截器代码顶部注释中明确说明，controller 中也有注释 |
| 登录审计日志保持手动 | Auth controller 未改动 |
