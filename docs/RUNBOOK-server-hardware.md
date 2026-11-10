# 服务器硬件与系统信息

## 范围与口径

- 详情页在基础信息 / SSH 配置下方展示 CPU 型号、逻辑 CPU 数、架构、系统可见内存、根文件系统 `/` 容量与类型、发行版、内核、虚拟化信息。
- 不修改服务器列表布局；不采集主机名、硬件序列号、MAC、云实例凭证，不跑分或探测套餐带宽。
- 仅已识别的虚拟机 guest 显示 vCPU；其他环境显示逻辑 CPU。容器内可见资源不是 cgroup 配额；根文件系统容量不是所有磁盘总容量。
- 旧 Agent、首次等待、部分采集失败、配置过期、离线均有独立文案。SSH 凭证销毁不影响 Agent 上报。

## 数据流

Agent 1.9.0 的独立工作协程在启动后及成功上报后一小时重新采集，通过 `POST /api/agent/system-info` 上报；原心跳 DTO 和每轮心跳行为保持不变。

协议包含 `agentToken`、`agentVersion`、`schemaVersion: 1`、`collectedAt`、`values`。字段采集失败时省略字段，不填零。接口限制字符串长度、CPU 数和容量范围，拒绝未知字段、未知格式版本和任意指定 serverId。

后端通过 Token 绑定服务器，在事务中锁定该服务器行并更新一对一 `ServerSystemInfo`。已删除、正在删除、已退役和 ERROR 状态不会被硬件上报重新激活；上报不写 status、lastSeenAt、资源使用率或 ServerMetric。详情读取沿用 userId 所有权约束，列表接口不携带配置快照。

每个成功字段分别保存 `{ value, collectedAt }`。本次失败的字段保留上次成功值及原时间，并记入 `missingFields`；页面明确标为旧值。重复或乱序快照不刷新接收时间。离线不清空硬件快照，删除服务器级联删除快照。

## 时效与失败处理

- 硬件快照超过 2 小时未采集即提示过期，与 120 秒心跳阈值分开。
- 拒绝超过 24 小时的上报或快于面板时钟 5 分钟以上的时间戳，需先校准 Agent 系统时间。
- 采集使用 5 秒 context；独立工作协程不会阻塞主心跳。系统库若不响应取消，最多阻塞该工作协程，不会重复创建采集协程。
- 网络 / 服务错误指数退避 1、2、4、8、16、32、60 分钟；401/403 退避 1 小时，不换端点重试认证；旧面板的 404/405 退避 6 小时。
- 传输继承现有 HTTPS 优先与网络故障备用地址行为，不为本功能改变既有面板连接配置。
- 不提供“立即刷新”按钮，也不把刷新页面伪装为重新采集。

## 发布与回滚

此功能的本地实现不代表生产部署或真实 VPS 验收完成。

1. 经授权备份数据库，先应用增量迁移 `20261111000000_add_server_system_info`，再发布后端与前端。
2. 不自动升级存量 Agent。先选择一台 Linux amd64/arm64 试点升级至 1.9.0；核对 CPU、内存、`/` 文件系统与系统版本。
3. 验证最后心跳、节点连通性、流量上报、订阅行为和 SSH 凭证状态不变，再扩大升级。
4. 面板回滚可保留新增表，旧代码忽略它；新 Agent 遇到不存在的接口自动退避，原心跳不受影响。恢复新面板后最长等待 6 小时重新上报；若需即时恢复，可在单独批准后重启 Agent。
5. Agent 回滚后保留旧快照并最终显示过期。不为回滚删除表，也不恢复不相关数据库内容。

## 本地验证

全部数据库测试使用独立 Unix socket 临时 PostgreSQL，浏览器仅使用合成数据并拦截外部请求。不得使用生产 DATABASE_URL 跑测试。

```sh
# 在 apps/server 下
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture pnpm exec prisma generate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture pnpm exec prisma validate
pnpm exec jest --runInBand --coverage=false
pnpm exec nest build

# 在 apps/agent 下
go test -mod=readonly -race ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -o /tmp/hardware-agent-amd64 .
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -mod=readonly -o /tmp/hardware-agent-arm64 .

# 仓库根目录；PG_BIN 指向本地 PostgreSQL 工具链
PG_BIN=/path/to/postgresql/bin SERVER_BUILD_DIR=apps/server/dist node --test scripts/tests/database-integration.mjs
pnpm --filter @nextpannel/web build
node scripts/tests/browser-smoke.mjs
```

新增测试入口：`system-info.service.spec.ts`、`system_info_test.go`、`system-info-pg.fixture.mjs`、`system-info-browser.py`。后两项已接入现有数据库与浏览器回归入口。

浏览器覆盖桌面 / 手机、明暗主题、正常 / 失败 / 过期 / 离线 / 旧版本、容器口径、长文本转义和无写操作。真实 Linux 服务器的采集准确性及生产升级仍需独立验收。
