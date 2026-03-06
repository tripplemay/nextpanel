# 技术设计：节点管理 UI 优化 + 审计日志权限 + CF DNS 清理

**日期**：2026-03-07
**状态**：已完成并上线

---

## 一、删除节点时同步清理 CF DNS 记录

### 问题

存在两条删除路径，但只有 REST 路径做了 CF DNS 清理：

| 路径 | 入口 | CF DNS 清理 |
|------|------|-------------|
| REST DELETE | `NodesService.remove()` | ✅ 已有 |
| SSE 流式删除 | `NodeDeployService.doUndeployWithLogs()` | ❌ 缺失 |

前端实际使用 SSE 路径，导致 CF DNS 记录从未被清理。

### 方案

在 `NodeDeployService` 中注入 `CloudflareService`，在 `doUndeployWithLogs` SSH 清理成功后、DB 删除前执行 CF DNS 清理。失败非致命（只记 log，不阻塞删除）。

### 改动文件

- `apps/server/src/nodes/node-deploy.service.ts`

---

## 二、审计日志访问控制

### 问题

`GET /audit-logs` 接口无角色限制，任意登录用户可查看所有人的审计日志。

### 需求讨论

- 过滤维度：按 `actorId`（成本低，行为符合预期）vs 按资源归属（成本高，联表查询）→ 选 **actorId**
- 接口方式：同一接口按角色过滤 vs 分两个接口 → 选**同一接口**
- 前端入口：审计日志已在 `baseMenuItems`，所有用户可见，无需改动

### 方案

- `audit.controller.ts`：注入 `@CurrentUser()`，ADMIN 时 `actorId=undefined`（不过滤），非 ADMIN 传 `user.id`
- `audit.service.ts`：`findAll` 增加可选 `actorId` 参数，有值时加入 `where` 条件

### 改动文件

- `apps/server/src/audit/audit.controller.ts`
- `apps/server/src/audit/audit.service.ts`

---

## 三、节点管理界面 UI/UX 优化

### 3.1 空白行问题

**原因**：`Table` 的 `pagination` 默认 pageSize=10，节点少时分页栏仍渲染，Ant Design Table 保留空白占位。

**方案**：节点数 ≤ 10 时隐藏分页：
```tsx
pagination={serverNodes.length > 10
  ? { showTotal: (total) => `共 ${total} 条` }
  : false}
```

### 3.2 国旗图标

**需求**：服务器名称后、区域 Tag 前，显示圆形国旗 emoji，方便识别节点区域。

**方案讨论**

| 方案 | 成本 | 风险 |
|------|------|------|
| 前端映射表（中文→ISO） | 低 | region 自由文本，映射不稳定 |
| 后端新增 `countryCode` 字段（ISO 3166-1） | 中 | 一次性，长期零维护 |

选择**方案二**。`ServerFormModal` 已通过 `ipapi.co` 获取 `country_code`，只需将其单独存入新字段。

**国旗 emoji 实现**（零依赖，Unicode Regional Indicator）：
```ts
const toFlagEmoji = (code: string) =>
  [...code.toUpperCase()]
    .map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
```

### 改动文件

- `apps/server/prisma/schema.prisma` — 加 `countryCode String?`
- `apps/server/prisma/migrations/20260307_add_country_code_to_server/migration.sql`
- `apps/server/src/servers/dto/create-server.dto.ts`
- `apps/server/src/servers/servers.service.ts`
- `apps/web/src/types/api.ts`
- `apps/web/src/components/servers/ServerFormModal.tsx`
- `apps/web/src/app/(dashboard)/nodes/page.tsx`

---

## 踩坑记录

1. **迁移文件未生成**：本地 DB SSH 隧道未开启，`prisma migrate dev` 失败，只提交了 schema 变更，导致生产 500。需手动创建迁移 SQL 文件。
2. **测试文件未同步**：新增构造函数参数后未更新 spec 文件，CI 构建失败。改构造函数签名时必须同步更新 spec。
