# VIEWER 角色与订阅分享功能

**日期**：2026-03-11
**状态**：实现中

---

## 需求确认

| 问题 | 结论 |
|------|------|
| VIEWER 定位 | OPERATOR 的升级版，拥有 OPERATOR 全部权限 |
| 额外功能 | 可以看到管理员分享给自己的订阅链接 |
| 分享入口 | 订阅详情/编辑抽屉，管理员选择分享给哪些用户 |
| 多对多关系 | 一条订阅可分享给多个 VIEWER，一个 VIEWER 可收到多条 |
| VIEWER 可见内容 | 专属订阅链接（`/share/:shareToken`） + 包含的节点列表 |
| VIEWER 操作权限 | 只读，不能新建/删除/修改/刷新 token |
| 分享情况查看 | 列表页显示「已分享 N 人」Tag + 详情抽屉管理 |
| 取消分享后链接 | 方案 C：每个分享关系独立 shareToken，取消后立即失效 |
| 已有节点访问 | 无法完全阻断，已知局限，后续优化 |

---

## 实现方案

### Phase 1：数据库

新增 `SubscriptionShare` 表（多对多，含独立 shareToken）：

```prisma
model SubscriptionShare {
  id             String       @id @default(cuid())
  subscription   Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  subscriptionId String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId         String
  shareToken     String       @unique @default(cuid())
  createdAt      DateTime     @default(now())

  @@unique([subscriptionId, userId])
}
```

### Phase 2：后端权限修复

所有 `@Roles('ADMIN', 'OPERATOR')` → `@Roles('ADMIN', 'OPERATOR', 'VIEWER')`

涉及模块：`servers`、`nodes`、`operation-log`（约 20 处）。

### Phase 3：订阅模块 API

**新增接口**：
- `POST /subscriptions/:id/shares` — 分享给用户，生成 shareToken（ADMIN+OPERATOR）
- `DELETE /subscriptions/:id/shares/:userId` — 取消分享（ADMIN+OPERATOR）
- `GET /subscriptions/:id/shares` — 查询已分享用户列表（ADMIN+OPERATOR）

**新增公开接口（shareToken）**：
- `GET /subscriptions/share/:shareToken` — V2Ray base64
- `GET /subscriptions/share/:shareToken/clash` — Clash YAML
- `GET /subscriptions/share/:shareToken/singbox` — SingBox JSON

**改造现有接口**：
- `GET /subscriptions` — VIEWER 只返回分享给自己的（含 shareToken 链接）
- `GET /subscriptions/:id` — VIEWER 访问未分享给自己的返回 403
- 写操作加 `@Roles('ADMIN', 'OPERATOR')`

### Phase 4：前端改造

**订阅列表页（ADMIN/OPERATOR）**：
- 新增「分享情况」列，显示「已分享 N 人」Tag

**订阅编辑抽屉（ADMIN/OPERATOR）**：
- 新增「分享给用户」区块，支持添加/移除 VIEWER 用户

**订阅列表页（VIEWER）**：
- 只显示被分享的订阅
- 隐藏新建/删除/编辑/刷新 Token 按钮
- 专属链接使用 `/share/:shareToken` 格式

**VIEWER 只读详情**：
- 显示专属订阅链接（可复制，含三种格式）
- 显示包含的节点列表（只读）
