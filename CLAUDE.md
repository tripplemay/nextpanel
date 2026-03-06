# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# 项目根目录
pnpm install          # 安装所有依赖
pnpm dev              # 并行启动所有服务
pnpm build            # 构建所有包
pnpm lint             # 检查所有包

# 后端（cd apps/server）
pnpm dev              # NestJS 监听模式，端口 3001
pnpm build            # 编译 TypeScript
pnpm test             # 运行所有 Jest 单元测试
pnpm test:cov         # 运行测试并生成覆盖率报告
pnpm lint             # eslint src --ext .ts

# 运行单个测试文件
cd apps/server && pnpm test -- --testPathPattern=nodes.service

# 前端（cd apps/web）
pnpm dev              # Next.js 开发模式，端口 3400
pnpm dev:clean        # 清除 .next 缓存后启动（修复 pnpm build 后 404 问题）
pnpm build            # 生产构建（验证 TS 错误）
pnpm lint             # next lint

# 数据库（在 apps/server 目录下）
pnpm exec prisma migrate dev --name <变更描述>   # 创建并应用迁移
pnpm exec prisma db seed                         # 初始化管理员用户
pnpm exec prisma studio                          # 可视化数据库浏览器，端口 5555
pnpm exec prisma migrate reset --force           # 重置数据库（删除所有数据）
pnpm exec prisma migrate status                  # 查看迁移状态
```

Swagger UI：http://localhost:3001/api/docs（后端运行时可访问）

> **注意**：修改 `schema.prisma` 后必须生成迁移文件再提交。若本地数据库不可达导致 `prisma migrate dev` 失败，需手动在 `prisma/migrations/` 下创建迁移目录和 `migration.sql` 文件，否则生产环境会 500。

## 架构概览

**Monorepo 结构**（pnpm workspaces）：
- `apps/server` — NestJS 10 后端，端口 3001
- `apps/web` — Next.js 15 前端，端口 3400
- `packages/shared` — 共享 TypeScript 枚举和接口（导入路径：`@nextpannel/shared`，注意包名有双 n）

**前端 → 后端代理**：`apps/web/next.config.ts` 将 `/api/*` 转发到 `http://localhost:3001/api/*`（可通过 `API_URL` 环境变量配置）。前端所有 `api.ts` 调用均使用相对路径 `/api`。

### 后端（NestJS）

采用标准 NestJS 按功能模块组织结构，每个功能目录包含 `*.module.ts`、`*.controller.ts`、`*.service.ts` 和 `dto/` 子目录。

**模块列表**：`AuthModule`、`ServersModule`、`NodesModule`、`TemplatesModule`、`ReleasesModule`、`SubscriptionsModule`、`MetricsModule`、`AgentModule`、`AuditModule`、`PipelinesModule`、`OperationLogModule`。

**认证与授权**：
- `JwtAuthGuard`（`common/guards/jwt-auth.guard.ts`）— 验证所有受保护路由的 Bearer Token
- `RolesGuard`（`common/guards/roles.guard.ts`）— 检查 `@Roles('ADMIN', 'OPERATOR')` 装饰器
- `@CurrentUser()` 装饰器从请求中提取当前用户
- 角色级别：`ADMIN` > `OPERATOR` > `VIEWER`
- 审计日志（`GET /audit-logs`）：ADMIN 可查看全部记录；非 ADMIN 只能查看自己的（按 `actorId = currentUser.id` 过滤）

**审计日志** — `@Audit` 装饰器 + `AuditInterceptor`（全局注册为 `APP_INTERCEPTOR`）：
- 在 controller 方法上加 `@Audit('CREATE', 'node')` 即可在 handler 返回后自动写入 `AuditLog`
- 拦截器在 handler 执行**前**生成 `correlationId` UUID 并存入 `req.correlationId`
- SSE 端点（`@Sse`）返回 `Observable`，无法使用拦截器——需手动调用 `auditService.log()` 并自行生成 `correlationId`

**节点部署** — 双路径架构：
- REST `POST /nodes/:id/deploy` → 即发即忘（无流式输出）
- SSE `GET /nodes/:id/deploy-stream` → `NodeDeployService.deployStream()` 返回 `Observable<MessageEvent>`；前端通过 `useDeployStream` hook 使用 `EventSource`
- SSH 清理必须成功后才能删除 DB 记录（SSH 优先模式）
- 两条删除路径（REST `DELETE /nodes/:id` 经 `NodesService.remove` 和 SSE `GET /nodes/:id/delete-stream` 经 `NodeDeployService.doUndeployWithLogs`）在 `cfDnsRecordId` 存在时均会清理 Cloudflare DNS 记录 — CF 清理失败非致命（记录错误但不阻塞删除）
- `NodeDeployService` 通过 `nodes/config/xray-config.ts` 或 `nodes/config/singbox-config.ts` 生成节点配置（由 `nodes/config/config-generator.ts` 选择）

**OperationLog / correlationId 链路**：
- `OperationLog` 存储每次部署/卸载操作的 SSH 终端完整输出
- `correlationId` 将 `AuditLog` 记录与 `OperationLog` 记录关联，供 UI 下钻查看
- `OperationLogController` 路由：`GET /operation-logs/by-resource/:type/:id`、`GET /operation-logs/by-correlation/:correlationId`、`GET /operation-logs/:id`

**加密**：`CryptoService`（`common/crypto/crypto.service.ts`）使用 AES-256-GCM。加密字段使用 `Enc` 后缀（`sshAuthEnc`、`credentialsEnc`、`githubTokenEnc`）。格式：`base64(iv[12] + tag[16] + ciphertext)`。

**Agent 通信**：远程 Agent 通过 `agentToken`（每个 Server 唯一）进行认证。Agent 轮询 `GET /api/releases/pending` 并通过 `POST /api/agent/heartbeat` 上报状态。

**Pipelines 模块**：管理 GitHub Actions CI/CD 集成——存储构建/部署命令，通过 `GET /api/pipelines/:id/github-config` 生成 GitHub Actions YAML 和 webhook 密钥。

**订阅**：`GET /api/subscriptions/link/:token`（V2Ray base64）、`/clash`（YAML）、`/singbox`（JSON）。URI 构建器位于 `subscriptions/uri-builder.ts`。

### 前端（Next.js 15 App Router）

**路由分组**：
- `(auth)/` — 登录页（无需认证）
- `(dashboard)/` — 所有受保护页面；layout 通过 `useAuthStore` 在客户端校验 JWT

**状态管理**：
- `Zustand`（`store/auth.ts`）— 通过 `persist` 中间件将 `token` 和 `user` 持久化到 `localStorage`
- `TanStack Query` — 服务端状态；配置 `staleTime: 30_000`，`retry: 1`

**API 客户端**（`lib/api.ts`）：Axios 实例，请求拦截器注入 `Authorization: Bearer <token>`，响应拦截器在 401 时跳转到 `/login`。所有响应类型定义在 `src/types/api.ts`。

**UI**：Ant Design 5，使用 `zhCN` 中文语言包。SSR 兼容需要 `@ant-design/nextjs-registry`。应用包裹在 `<Providers>`（`app/providers.tsx`）中 — QueryClient + ConfigProvider（全局 `borderRadius: 8` token）+ App。

**前端规范**（所有页面统一执行）：
- 所有页面：`<Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>` 包裹
- 所有表格：`size="middle"` 且 `pagination={{ showTotal: (total) => \`共 ${total} 条\` }}` — 例外：按服务器分组视图中，节点数 ≤ 10 时隐藏分页，避免空白占位
- `<PageHeader>` 自带 `<Divider>`，表格前**不要**加 `marginBottom`
- 状态展示：使用 `<StatusTag status={...} />`（`components/common/StatusTag.tsx`），不要自行组合 Badge/Tag

**组件结构**（`components/`）：按功能组织 — `servers/`、`nodes/`、`templates/`、`pipelines/`、`subscriptions/`、`common/`。

关键共享组件：
- `common/PageHeader.tsx` — 标题 + 新增按钮 + Divider
- `common/StatusTag.tsx` — 带状态颜色映射的 Tag
- `common/CopyButton.tsx` — 带反馈的剪贴板复制按钮
- `nodes/DeployDrawer.tsx` — SSE 终端抽屉（部署和删除共用）
- `nodes/DeployLogModal.tsx` — 操作历史弹窗（列出节点历次部署/卸载日志）
- `hooks/useDeployStream.ts` — `EventSource` 封装，基于 URL 复用

### 数据库（PostgreSQL + Prisma）

关键 Schema 说明：
- `Server.sshAuthEnc` — 加密的 SSH 密钥或密码
- `Server.countryCode` — 可选的 ISO 3166-1 alpha-2 国家码（如 `SG`、`JP`），服务器创建时通过 geo-IP 自动填充，用于节点页面显示国旗 emoji
- `Node.credentialsEnc` — 加密的 JSON 凭证（`{ uuid?, password?, method? }`）
- `Pipeline.githubTokenEnc` — 可选的加密 GitHub PAT
- `OperationLog` — 通用资源模型：`resourceType`、`resourceId`、`resourceName`、`operation`（字符串，非枚举）、`correlationId`、`log`（完整 SSH 输出）
- `AuditLog.correlationId` — 关联到 `OperationLog.correlationId`
- `ServerMetric` — 按 `[serverId, timestamp]` 建索引，用于时序查询
- `ConfigSnapshot` — 按 `[nodeId, version]` 唯一约束，用于版本化配置

### 共享包

`packages/shared/src/enums.ts` — 所有领域枚举（`Protocol`、`Implementation`、`Transport`、`TlsMode`、`UserRole`、`ReleaseStatus`、`ReleaseStrategy` 等）。导入路径：`@nextpannel/shared`（注意包名双 n）。

## 环境变量

后端（`apps/server/.env`）：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `JWT_SECRET` | 64 位十六进制（`openssl rand -hex 32`） |
| `JWT_EXPIRES_IN` | Token 有效期，默认 `7d` |
| `ENCRYPTION_KEY` | 64 位十六进制，必须恰好 32 字节 |
| `PORT` | 服务端口，默认 `3001` |
| `ALLOWED_ORIGIN` | CORS 来源，默认 `http://localhost:3000`——本地开发设为 `http://localhost:3400` |
| `PANEL_URL` | 面板公网 URL（Agent 安装脚本使用），如 `https://your-panel-domain.com` |
| `GITHUB_REPO` | Agent 发布的 GitHub 仓库路径，如 `your-username/nextpanel` |

前端（`apps/web/.env.local`）：

| 变量 | 说明 |
|------|------|
| `API_URL` | 代理转发的后端 URL，默认 `http://localhost:3001` |

## Windows 注意事项

**Prisma DLL 锁定**：运行中的后端持有 `query_engine-windows.dll.node`。后端运行时执行 `prisma generate` 会失败。使用项目根目录的 `find-prisma-lock.ps1` 找到占用进程 PID，先杀掉再重新生成。

**.next 缓存冲突**：在 `apps/web` 执行 `pnpm build` 会生成生产 `.next` 目录。之后启动开发服务器会导致静态资源 404。解决方法：改用 `pnpm dev:clean`（先删除 `.next` 再启动）。

**Git Bash taskkill**：`taskkill /PID 1234 /F` 在 Git Bash 中会失败，因为 `/PID` 被识别为路径。改用 `cmd //c "taskkill /PID 1234 /F"`。
