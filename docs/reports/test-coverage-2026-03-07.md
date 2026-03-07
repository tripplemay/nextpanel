# NextPanel 服务端测试报告

**日期**：2026-03-07
**范围**：`apps/server`（NestJS 后端）
**测试框架**：Jest + TypeScript
**提交**：`9e43605`

---

## 一、总体覆盖率

| 指标 | 修复前 | 修复后 | 变化 |
|------|--------|--------|------|
| 语句覆盖率 | 93.17% | **95.98%** | +2.81% |
| 分支覆盖率 | 83.44% | **87.59%** | +4.15% |
| 函数覆盖率 | 93.81% | **95.74%** | +1.93% |
| 行覆盖率   | 94.21% | **96.87%** | +2.66% |

| 维度 | 修复前 | 修复后 |
|------|--------|--------|
| 通过的测试套件 | 17 / 21 | **24 / 24** ✅ |
| 通过的测试用例 | 372 / 376 | **455 / 455** ✅ |

---

## 二、问题修复（4 个失败套件）

### 2.1 `auth.service.spec.ts`

**根因**：上一次 schema 迁移（新增 `InviteCode` 模型字段）后未重新运行 `prisma generate`，导致 mock 对象的 TypeScript 类型与 Prisma Client 类型不匹配，测试套件无法编译。

**修复措施**：
- 运行 `prisma generate` 刷新 Prisma Client 类型
- 在 `mockPrisma.user` 中补充 `update` mock 方法
- 补充 `changePassword` 方法的完整测试（3 个用例：用户不存在、密码错误、成功更新）

---

### 2.2 `servers.service.spec.ts`

**根因**：`ServersService.remove()` 已重构为异步触发后不等待（fire-and-forget）模式——立即返回 `{ status: 'DELETING' }`，实际的 SSH 清理与数据库删除在后台 `runDelete()` 中异步完成。原测试未感知这一行为变化，存在以下问题：

1. 未 mock `server.update`（DELETING 状态更新），导致调用抛错
2. 未 mock `node.findMany`，`runDelete` 拿到 `undefined` 后 `.map()` 抛 `TypeError`
3. 测试断言在后台任务完成前已执行，导致 `server.delete` 断言失败
4. 一个测试断言"undeploy 失败后仍删除服务器"——与实际逻辑相反（undeploy 失败时服务器被设为 ERROR，不触发删除）

**修复措施**：
- 新增 `flushPromises` 工具函数（`setTimeout(resolve, 0)`），在每个 `remove` 测试中等待后台任务完成
- 所有 `remove` 相关测试补充 `server.update` 和 `node.findMany` mock
- 修正错误断言：undeploy 失败场景改为断言 `server.update` 收到 `status: 'ERROR'`，且 `server.delete` 未被调用
- 第一个测试同样补充 `flushPromises`，避免后台任务泄漏到下一个测试（`clearAllMocks` 竞态）

---

### 2.3 `subscriptions.service.spec.ts`

**根因**：`generateClashContent` 的返回类型由 `string` 变更为 `{ content: string; name: string }`，原测试直接对返回值调用 `.toContain()`，实际是对 Object 调用，导致 `TypeError: received is not iterable`。另外，YAML 末尾规则使用了 `MATCH,🐟 漏网之鱼` 而非测试中硬编码的 `MATCH,DIRECT`。

**修复措施**：
- 将所有 Clash 测试的 `result.toContain(...)` 改为 `result.content.toContain(...)`
- 修正末尾规则断言为 `MATCH,`（前缀匹配，避免与模板内容绑定）
- 在 `mockPrisma.subscription` 中补充 `update` mock
- 新增 `update` 方法测试（NotFoundException、改名、替换节点列表）
- 新增 `refreshToken` 方法测试（NotFoundException、成功刷新）

---

### 2.4 `node-deploy.service.spec.ts`

**根因**：V2RAY 自动安装测试的 `execCommand` mock 序列少了一次调用。服务中 `const isXray = impl === 'XRAY' || impl === 'V2RAY'`，V2RAY 同样会计算 statsPort，因此 `freePortIfOrphaned` 会依次对 statsPort 和 listenPort 各调用一次 `fuser`，共两次。原测试只 mock 了一次，导致第二次 `fuser` 取到错误返回值，服务判定为错误，`success` 返回 `false`。

**修复措施**：在 apt-get / curl / test 三步之后、daemon-reload 之前，补充一次 statsPort 的 `fuser` mock。

---

## 三、新增测试文件（原覆盖率 0%）

### 3.1 `users/users.service.spec.ts`（0% → 100%）

| 测试用例 | 覆盖点 |
|----------|--------|
| `findAll` 按 createdAt 升序返回所有用户 | 正常路径 |
| `updateRole` 修改自己的角色 → ForbiddenException | 边界 |
| `updateRole` 用户不存在 → NotFoundException | 错误路径 |
| `updateRole` 目标为 ADMIN → ForbiddenException | 边界 |
| `updateRole` 成功更新并返回安全字段 | 正常路径 |
| `remove` 删除自己 → ForbiddenException | 边界 |
| `remove` 用户不存在 → NotFoundException | 错误路径 |
| `remove` 删除最后一个 ADMIN → BadRequestException | 边界 |
| `remove` 存在多个 ADMIN 时允许删除 | 正常路径 |
| `remove` 删除非 ADMIN 用户不检查 adminCount | 分支 |

### 3.2 `invite-codes/invite-codes.service.spec.ts`（0% → 100%）

| 测试用例 | 覆盖点 |
|----------|--------|
| `create` 按 quantity 批量创建并返回 | 正常路径 |
| `create` 正确传递 maxUses 到每条记录 | 参数校验 |
| `findAll` 包含 creator.username 关联字段 | 正常路径 |
| `remove` code 不存在 → NotFoundException | 错误路径 |
| `remove` 删除并返回被删记录 | 正常路径 |

### 3.3 `rules/rules.service.spec.ts`（0% → 96.77%）

| 测试用例 | 覆盖点 |
|----------|--------|
| `getContent` 未知规则名 → NotFoundException | 错误路径 |
| `getContent` 规则未缓存 → NotFoundException | 错误路径 |
| `getContent` 返回缓存内容与 behavior | 正常路径 |
| `refreshAll` 刷新所有规则并 upsert | 正常路径 |
| `refreshAll` 单个 fetch 失败时继续处理其余规则 | 容错 |
| `refreshAll` HTTP 非 200 时不写入缓存 | 错误路径 |

---

## 四、各文件最终覆盖率

| 文件 | 语句 | 分支 | 函数 | 行 |
|------|------|------|------|----|
| `auth.service.ts` | 100% | 100% | 100% | 100% |
| `users.service.ts` | 100% | 100% | 100% | 100% |
| `invite-codes.service.ts` | 100% | 100% | 100% | 100% |
| `subscriptions.service.ts` | 98.21% | 92.85% | 100% | 100% |
| `rules.service.ts` | 96.77% | 100% | 83.33% | 96.15% |
| `servers.service.ts` | 94.27% | 86.07% | 84% | 96.06% |
| `node-deploy.service.ts` | 93.24% | 80.81% | 94.44% | 94.52% |
| `crypto.service.ts` | 100% | 100% | 100% | 100% |
| `metrics.service.ts` | 100% | 100% | 100% | 100% |
| `operation-log.service.ts` | 100% | 100% | 100% | 100% |

---

## 五、已知覆盖率缺口（暂不处理）

| 文件 | 未覆盖行 | 原因 |
|------|----------|------|
| `prisma.service.ts` | 10–14 | NestJS 生命周期钩子（`enableShutdownHooks`），需集成测试 |
| `agent.service.ts` | 76–77, 92 | Agent 版本比对与写入逻辑，依赖真实 DB |
| `audit.service.ts` | 35–36 | 审计日志失败时的静默降级分支 |
| `servers.service.ts` | 102–103, 149–150 | `forceRemove` 及相关路径，可后续补充 |
| `rules.service.ts` | 63 | `onModuleInit` → `@Interval` 调度器调用路径 |
