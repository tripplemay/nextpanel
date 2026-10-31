# 服务端使用观测实现与本地验收

日期：2026-10-31。分支：`feat/server-usage-observability`。

## 交付范围

- `/usage`：活跃使用、优选状态、接入与覆盖；桌面表格、手机卡片、明暗主题、证据详情和按小时趋势。
- 复用现有 CF 状态 API，展示订阅自动优选开关、测点结果、运营商缺测、候选记录、预算保护和异常，不增加探针调用。
- 每个订阅授权版本、节点和候选配置独立认证身份。保留旧 UUID、原链接和 CDN 参数；持久化与运行 UUID 双验证通过后才发布。
- Agent 1.8.0：异步有界采样、白名单计数、轮转、面板回退兼容；面板异步有界入库、租户隔离、去重、过期判定与保留策略。
- 首次节点准备显式确认；后续仅热同步。权限、配置漂移、回退失败及静默 API 失败均有保护和测试。

## 验证结果

以下均为本地或隔离 fixture 证据，不是生产验收。

| 验证 | 结果 / 范围 |
| --- | --- |
| 后端 Jest | 55 组、1,116 项通过；包含本功能 24 项权限、DTO、发布门禁、回退、撤销和采样边界测试 |
| 脚本与原生门禁 | 57 项通过，0 跳过；Xray、sing-box、Mihomo 均提供原生二进制 |
| 原生身份链路 | 本机 loopback TLS + VLESS + WS 转发；热添加/撤销、独立流量、旧凭据、持久化重启、Go gRPC 解码通过 |
| PostgreSQL | 新建隔离集群迁移、并发去重、所有者隔离、首样本未知速率、增量和乱序去重、暂停/撤销、备份恢复通过 |
| Agent | `go test -mod=readonly -race ./...` 通过；Linux amd64/arm64 ELF 交叉构建通过，未在 Linux 目标机运行 |
| 类型与构建 | Prisma generate/validate、后端 TypeScript/Nest、前端 Next.js 生产构建通过 |
| 代码检查 | ESLint 零警告、diff whitespace 检查通过 |
| 浏览器 | 隔离前端，所有业务 API 均为合成 fixture；原安全、发布、资源生命周期及 CF 订阅回归通过 |
| 新页面 | 1440/390 px × 明/暗主题；筛选、滚动、详情、趋势、优选状态、准备取消无写入、热同步不授权重启、暂停、请求失败与全局暂停状态通过 |

测试使用本机 Xray 26.2.6、sing-box 1.13.0、Clash Verge 随附 Mihomo，以及临时 Go 1.27.3 工具链。没有连接生产 SSH、修改生产数据库或执行付费云测速。

完整门禁之后，针对最后的「首样本速率为未知而非零」和回退/撤销边界补充，重新执行了后端全量 Jest、TypeScript/Nest、PostgreSQL；前端微调重新构建并执行四种新页面浏览器验收。

本地证据（忽略目录，不进入发布包）：

- `out/ci/server-usage-verification.log`
- `out/ci/server-usage-final-jest.log`
- `out/ci/server-usage-final-web-build.log`
- `out/ci/server-usage-final-browser.log`
- `out/ci/usage-1440-light.png`、`out/ci/usage-cf-1440-light.png`
- `out/ci/usage-390-light.png`、`out/ci/usage-cards-390-dark.png`
- `out/ci/usage-detail-1440-dark.png`、`out/ci/usage-coverage-390-dark.png`

## 已修正的验收发现

- Xray `api adu` 可能退出码为零却未添加用户：配置补齐端口，且强制读回精确 UUID，不能只相信命令退出码。
- 首次计数/重启/断采样不显示为已测零速率；过期样本不作为活跃证明。
- 图表按实际小时位置绘制，空缺不压缩成连续流量；待同步记录不显示为已使用证据。
- 新 Agent 向已回退的旧面板发送扩展字段被拒绝时，有限重试普通心跳；认证失败不触发降级。
- 超过单批 20 个节点时轮转，避免永久漏采后续节点。
- 回退或远端撤销无法验证时不宣告成功；保留旧凭据及观测发布门禁。

## 尚未执行 / 不作承诺

- 未提交、推送、运行远端 CI 或部署；未启用生产观测开关。
- 未升级生产 Agent、执行首次节点重启或开展真实 CDN/客户端验证。
- 本功能证明授权凭据对应节点的聚合流量，不证明真实在线人数、实际拨入 CF IP、实际运营商、访问网站或连接总数。
- 高频大规模采集负载、非 Chromium 浏览器和真实手机硬件未做专门性能/兼容验收。
- 旧共享 UUID 为兼容而保留，因此删除分享不等于所有历史访问方式立即失效。

生产步骤及回退约束：[`RUNBOOK-server-usage.md`](RUNBOOK-server-usage.md)。
