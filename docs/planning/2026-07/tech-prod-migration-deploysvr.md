# 生产迁移 Runbook：nextpanel → deploysvr

> 状态：**P1–P4 已完成并自测通过，等待用户确认后执行 P5（切 DNS + 重配 agent）与 P6（CI/CD + 旧机下线）**
> 日期：2026-07-13

## 背景

旧生产 VPS `38.175.193.100`（即将退役，共享机，另跑 aidash/worldcup 等）上的 nextpanel 面板迁移到
`deploysvr = 194.238.26.173`（同为共享机，全 Docker 部署，另跑 kolmatrix/aigc-gateway/invoce 等 6 个应用）。

**本次只迁 nextpanel，不动两台机器上的其它应用。** 旧机 nextpanel 保留运行至 P6 验证通过才下线（回滚保障）。

## 关键参数

| 项 | 旧机 (38.175.193.100) | 新机 deploysvr (194.238.26.173) |
|---|---|---|
| 面板域名 | vpn.vpanel.cc（CF proxied, LE 证书） | 同（CF A 记录切到新 IP） |
| server 端口 | 3001 | **3201** |
| web 端口 | 3000 | **3200** |
| agent 直连端点 | nginx :3003 → 3001 | nginx **:3205 → 3201**（已验证公网可达） |
| 数据库 | 原生 PG14 localhost:5432 | **Docker PG16** `nextpanel-postgres` 127.0.0.1:**5433**（compose 在 `/opt/apps/nextpanel-db/`，卷 `nextpanel_pgdata`） |
| 进程 | PM2 | PM2（`ecosystem.config.cjs`，日志 /var/log/nextpanel） |
| 部署路径 | /opt/apps/nextpanel | /opt/apps/nextpanel |

**CF DNS**：zone `vpanel.cc`=`36292af966f8ea8104ba87c7c17ef015`，记录 `vpn.vpanel.cc`=`1e24c094fc1b568a5ec0959656df8950`（A, proxied, 当前指 38.175.193.100）。

**.env 处理**：`ENCRYPTION_KEY`、`JWT_SECRET`（及 JWT_EXPIRES_IN/GITHUB_REPO/GFW_CHECK_FUNCTION_URL）从旧机逐字复制；
`DATABASE_URL` 指向 5433 新库（新密码存 `/opt/apps/nextpanel-db/.env`）；`PORT=3201`；`PANEL_DIRECT_URL=http://194.238.26.173:3205`；
新增 `METRIC_RETENTION_DAYS=14`；`PANEL_URL`/`ALLOWED_ORIGIN` 保持 `https://vpn.vpanel.cc`。`/opt/.nextpanel_setup_done` 已 touch。

## 已完成（P1–P4）

- **A 指标自动清理功能**：`MetricsService.pruneOldMetrics()` + `MetricsRetentionScheduler`（每日 04:00，`METRIC_RETENTION_DAYS` 默认 14，非正数回退保护）。3 新测试，全套 495 通过，tsc 干净。README/CLAUDE.md 已更新。
- **B 底座**：pnpm 10.34.5 + pm2 7.0.3；Docker PG16 容器 5433，健康。
- **C 数据迁移（非破坏性）**：旧库只读。导出 schema+全部数据(排除 ServerMetric) + 近 14 天 ServerMetric(990,093 行)。新库校验：Server=15/Node=23/SubscriptionNode=27/AuditLog=464/OperationLog=189/ConfigSnapshot=29/ServerMetric=990093/migrations=30。
- **D 部署**：代码同步 /opt/apps/nextpanel；构建成功；`prisma migrate deploy` 无 pending；PM2 3200/3201 online；nginx vhost + agent-direct(:3205)；LE 证书 DNS-01 预签成功（到期 2026-10-11，自动续期）。
- **E 自测**：/api/servers=401、/login=200（直连与经 nginx+TLS 均通过）；**ENCRYPTION_KEY 实测能解密迁移后的 sshAuthEnc/credentialsEnc**；server 日志正常（无错误，PingScheduler 正常）。

## 待执行（需用户确认）

### P5 / F — 切 DNS + 重配 agent
1. CF PATCH 记录 `1e24c094…` content → `194.238.26.173`（保持 proxied=True）。
2. 逐台对 10 台 ONLINE 服务器在新面板点「安装/重装 agent」→ 刷新 `/etc/nextpanel/agent.json` 的 `serverUrl=https://vpn.vpanel.cc`、`directUrl=http://194.238.26.173:3205`。旧机此时仍在，agent 零掉线。
3. 观察 10 台在新面板回到 ONLINE（心跳到达新库）。

### P6 / G — CI/CD 改造 + 旧机下线
1. 改 `.github/workflows/deploy.yml`：SSH 私钥认证；跳过原生 pg 安装；不再生成 .env；端口 3200/3201；agent-direct :3205；证书 DNS-01。
2. 更新 GitHub Secrets/Vars（SSH_HOST=194.238.26.173、SSH_PORT=22、部署私钥、DOMAIN 等）。**提交并推送需用户明确同意（既定规则）。**
3. 验证一次自动部署到新机。稳定后**仅停旧机 nextpanel**（pm2 stop/delete nextpanel-server/web、禁用 nginx vpn.vpanel.cc vhost、停 :3003）——不动 aidash/worldcup。
4. 更新本地 `~/.ssh/config` 的 `nextpanel-db` 与本地 `apps/server/.env` 指向（旧机退役后本地 dev 库 nextpanel_dev 也在旧机，需迁移或接受丢弃）。

## 回滚
- DNS 未切前：弃用新机即可，旧机原封不动。
- DNS 切后异常：CF 记录 content 改回 `38.175.193.100`；agent 的 directUrl 在重配前仍指旧机 → 天然回滚。

## 注意
- 迁移期间新旧两面板同时运行（各自独立库）。唯一有外部副作用的定时任务是 `CertRenewalScheduler`（每日 02:00 CEST，仅当 wildcard 证书临近到期才动作并重启节点）。建议在 02:00 CEST 前完成切换，或切换前临时停新面板。
