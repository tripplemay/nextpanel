# 安全与正确性修复包

日期：2026-10-07。基线：`f5d4a12`。

状态：本报告记录第 1、2 项的实现及发布前本地验证。后续已提交、推送、部署面板并完成批准范围内的 Agent 升级；生产证据及边界见 [发布验收报告](2026-10-07-production-release.md)。原有 338 项文件权限变化保持不动，未进入提交。

## 1. 安全边界

- **服务器所有权**：安装 Agent、旧 AutoSetup 接口要求当前用户拥有服务器。增加 SSE 前置 guard，确保未授权请求在响应头、token 和 SSH 操作之前被拒绝；服务层再次校验。
- **分享凭证**：分享列表使用字段白名单，不再返回所有者 token。前端明确区分主 token 与 shareToken，不再降级使用主 token。
- **日志隔离**：OperationLog 保存独立 ownerId；按资源、关联 ID、日志 ID 查询均实施所有权过滤。后台任务无 actor、资源删除后仍保留隔离；无法归属的历史日志仅管理员可读。
- **OAuth**：加密安全随机 state，数据库只存摘要；绑定 HttpOnly 浏览器 cookie、用途、当前用户与 5 分钟有效期；原子消费防重放。绑定前要求当前密码，回调地址固定为 PANEL_URL 下的两个回调路径。前端传回 state 并清除地址栏授权参数，原先隐藏的企业微信入口保持隐藏。
- **SSRF**：订阅 URL 与推荐提取共用公网抓取器。限制 HTTP/HTTPS，拒绝认证 URL、私网/环回/链路本地等地址；检查全部 DNS 结果并固定连接地址；逐跳检查最多 3 次重定向；总时限 15 秒，响应上限 2 MiB。不再记录完整订阅 URL。

主要入口：`apps/server/src/servers/server-owner.guard.ts`、`auth/oauth-state.service.ts`、`common/http/public-fetch.ts`、`operation-log/operation-log.service.ts`、`subscriptions/subscriptions.service.ts`。

## 2. 正确性与运维

- **恢复脚本**：所选备份与安全备份使用不同变量和唯一文件名；先停写再备份，恢复期间不轮转备份。通过条件分支捕获管道失败，psql 使用 `ON_ERROR_STOP=1` 与事务。失败时恢复明确的安全备份，成功回滚后重启服务但返回非零；回滚失败时保持停服。
- **Agent 1.7.0**：心跳上报 amd64/arm64，后端只下发同架构且有 SHA-256 的资产。Agent 校验可信 HTTPS 指令、下载摘要、大小、ELF 架构和候选版本，再替换文件。保留旧二进制，通过独立 systemd timer 在 180 秒未确认心跳时回滚。无法建立回滚监督则拒绝更新；并发任务标志改用 atomic。
- **生命周期**：心跳通过数据库条件更新，不能将 DELETING/ERROR 改回 ONLINE。安装脚本确认进程启动不再直接标记 ONLINE，必须等真实心跳。
- **端口与探针**：生产后端/前端统一为 3201/3200，开发保留 3001/3400；PM2、Nginx 模板、安装脚本、CLI、Next rewrite 一致，并增加一致性测试。提供 `/api/health/live` 和数据库就绪探针 `/api/health/ready`；安装健康检查不再依赖生产禁用的 Swagger，超时明确失败。重复安装拒绝覆盖已有加密密钥。
- **参数保真**：导入、持久化、URI/Clash/sing-box 导出及 Xray 测试配置保留 WS path/Host 与独立 SNI、gRPC serviceName、HTTP 认证和 HTTPS TLS；修正 Trojan/Hysteria2 密码编码。历史 WS Host 可从 rawUri 回读。本轮不是所有协议扩展参数的完整兼容矩阵。
- **AutoSetup**：不再虚报节点已部署。仅执行 SSH 连通性检查，非空模板配置明确拒绝，并同步修正界面提示。

## 验证结果

| 检查 | 结果与边界 |
| --- | --- |
| 后端 Jest | 40 个 suite、821 个测试全部通过；原基线 755 个 |
| HTTP 授权回归 | 真实 Nest 路由、JWT、角色 guard 和全局 interceptor；覆盖越权 SSE、日志三个入口、嵌套心跳校验；持久层隔离替身 |
| PostgreSQL 16.13 | 全量历史及新增 SQL 迁移链通过；验证日志归属回填、主 token 轮换、shareToken 保留、state 并发只消费一次、生命周期条件更新、删除后日志隔离 |
| 真实数据库恢复 | 临时 Unix-socket-only 集群；恢复指定备份成功；无效 SQL 触发失败并恢复到安全备份，断言数据值与退出码 |
| 运维测试 | 6 个测试通过，包含停止服务失败、备份失败、SQL 失败、回滚失败及端口一致性 |
| TypeScript/构建 | 前后端类型检查、后端 TypeScript 编译、Next 生产构建通过；25 个静态页面生成；产物 rewrite 指向 3201 |
| Go | 临时 Go 1.27.1 工具链；`go test -race`、`go vet` 通过；Linux amd64/arm64 构建与 ELF 检查通过，`--version` 返回 1.7.0 |
| 其他 | Prisma schema 校验、Shell 语法与 `git diff --check` 通过 |

前端构建在临时副本执行，避免改动工程中的构建缓存。临时 PostgreSQL 集群已停止并移除；没有连接工程 `.env` 中的数据库。Next 构建通过不代表独立 ESLint 配置已补全，也不代表浏览器人工验收通过。

### 重跑

在 `apps/server` 执行现有本地工具，避免当前 pnpm 自动接管 node_modules 的环境问题：

```sh
./node_modules/.bin/prisma generate
./node_modules/.bin/prisma validate
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/jest --runInBand --no-cache --coverage=false
```

在工程根目录执行运维测试；PostgreSQL 测试要求非 root 用户和显式工具链路径，并始终创建隔离集群：

```sh
node --test scripts/tests/*.test.mjs
PG_BIN=/path/to/postgresql/bin node --test scripts/tests/database-integration.mjs
bash -n scripts/nextpanel scripts/install.sh apps/agent/install.sh
```

在 `apps/agent` 执行：

```sh
go test -mod=readonly -race ./...
go vet -mod=readonly ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -o /tmp/agent-linux-amd64 .
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -mod=readonly -o /tmp/agent-linux-arm64 .
```

## 升级影响与发布前门槛（本地验收时记录）

1. 新增 `20261007000000_security_boundaries`、`20261007010000_transport_host` 两个迁移。上线需先备份、暂停旧后端，再执行迁移和启动新版本，不能让旧分享接口在轮换后继续提供服务。
2. **安全迁移会轮换所有订阅主 token**：历史已撤销分享也可能曾泄漏主 token，无法仅凭现存分享记录识别，因此全部主链接失效，需要所有者重新复制链接。每位接收者的 shareToken 不变。
3. OAuth 依赖正确的 PANEL_URL；HTTPS 环境使用 Secure cookie。旧的未完成授权会话需要重新发起。真实企业微信授权、浏览器 cookie 流程尚未验收。
4. 旧 Agent 不上报架构，后端不会猜测架构下发二进制；需在发布 1.7.0 后通过 SSH 做一次升级。自更新要求可信 HTTPS、GitHub release 资产摘要和 systemd。只有 HTTP 的面板仍可收心跳，但不接受自更新指令。
5. systemd timer 故障回滚机制已实现、文件替换/回滚逻辑已单测，**仍需 Linux amd64/arm64 实机升级、断网与启动失败演练**。交叉编译不等于这些运行验收。
6. 数据库恢复演练使用当前兼容 schema 与隔离数据；并未恢复真实业务备份、配置文件、证书或 ENCRYPTION_KEY。生产恢复还需确认代码/schema/密钥版本兼容。
7. 未执行 GitHub CI、PM2/Nginx 的真实部署、远程 SSH 安装或生产健康验收。后续仍需完整发布门禁；本报告不把本地通过视为可直接发布。

评审中的外部节点凭据静态加密、改密全会话失效、SSE EOF、订阅 N+1、指标限额/采样精度等不属于本轮列明的修复范围，仍需后续处理。

## 实现依据

更新摘要使用 GitHub Release Asset 的 `digest` 字段，缺失时拒绝下发，而不是猜测或跳过校验：[GitHub 官方接口](https://docs.github.com/en/rest/releases/assets)。独立回滚监督使用 transient timer 及完成后清理语义：[systemd-run 官方文档源码](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd-run.xml)。
