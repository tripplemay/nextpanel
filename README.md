# NextPanel

开源自部署的代理节点管理面板，支持一键安装、多协议节点部署、订阅生成与分享。

## 功能一览

### 服务器管理
- SSH 接入（密码/密钥），实时监控 CPU、内存、磁盘、网络
- 服务器列表支持表格/卡片双视图，支持标签筛选和批量 SSH 测试
- 自动标签：根据 IP 检测结果自动标注（数据中心/住宅 IP、流媒体解锁等）
- Agent 一键安装与远程自更新

### 节点部署
- 支持协议预设一键部署，无需手动填写参数
- 部署/删除过程 SSE 实时终端输出
- 节点连通性测试（Xray E2E 端到端验证），支持批量测试
- 流量统计（上传/下载累计）
- 节点启用/禁用开关

### 支持的协议

| 协议 | 实现 | 传输层 | TLS |
|------|------|--------|-----|
| VMESS | Xray | TCP, WS, gRPC | 无, TLS |
| VLESS | Xray | TCP, WS, gRPC | 无, TLS, REALITY |
| Trojan | Xray | TCP, WS | TLS |
| Shadowsocks | Xray / sing-box | TCP | 无 |
| Hysteria2 | sing-box | QUIC | TLS（自签证书）|

### 外部节点导入
- 支持粘贴 URI（vmess:// vless:// ss:// trojan:// hysteria2://）
- 支持 Base64 编码的订阅内容
- 支持订阅链接（https://...）自动拉取解析
- 导入后可测试连通性、加入订阅统一管理

### 订阅管理
- 生成三种格式：V2Ray Base64、Clash YAML、Sing-box JSON
- 托管节点与外部节点可混合加入同一订阅
- 节点列表中以"托管"/"外部"标签区分来源
- 支持刷新订阅链接（重新生成 token）
- 导出弹窗含链接复制 + QR 码

### 订阅分享
- ADMIN/OPERATOR 可将订阅分享给 VIEWER 用户
- 每个分享关系生成独立 shareToken
- VIEWER 通过专属链接获取订阅内容（只读）

### IP 检测与路由诊断
- IP 基础信息：类型（住宅/数据中心）、ASN、运营商、地区
- 流媒体解锁检测：Netflix、Disney+、YouTube、Hulu、Bilibili
- AI 服务可用性：OpenAI、Claude、Gemini
- GFW 封锁检测
- 路由测试：去程（面板端 itdog/chinaz API）+ 回程（Agent 测 9 个国内 ISP 节点）
- 测试结果矩阵展示，延迟按颜色分级

### Agent 系统
- 轻量 Go 二进制，以 systemd 服务运行在被管理服务器上
- 定期心跳上报：CPU、内存、磁盘、网络指标
- 执行流媒体/AI 服务检测
- 执行回程路由测试（ICMP/TCP 到 3 运营商 x 3 城市 = 9 节点）
- 支持面板触发远程自更新，自动安装 nexttrace

### 多租户与权限
- 三级角色：ADMIN > OPERATOR > VIEWER
- ADMIN：全局管理（用户、邀请码、所有资源）
- OPERATOR：管理自己的服务器、节点、订阅
- VIEWER：查看被分享的订阅，通过专属链接获取订阅内容
- 资源按 userId 隔离，服务层强制所有权校验

### 审计日志
- 所有关键操作自动记录（创建、更新、删除、部署、登录等）
- 支持按操作类型筛选
- 可展开查看变更 diff 和关联的部署日志
- correlationId 将审计记录与 SSH 终端输出关联

### 安全
- JWT 认证 + Token 吊销机制
- AES-256-GCM 加密存储 SSH 凭证、节点密码、API Token
- 登录速率限制（100 次/分钟）
- 账号锁定（5 次失败后锁定 15 分钟）
- X-Forwarded-For 真实 IP 记录

### 其他功能
- Cloudflare DNS 集成（VLESS+WS+TLS 节点自动创建/清理 DNS 记录）
- 邀请码注册（管理员生成，支持自定义码和使用次数限制）
- 用户管理（角色分配、批量操作）
- 新用户欢迎引导（WelcomeModal → 添加服务器 → 自动打开 Agent 安装）
- 全页面响应式适配（移动端卡片布局、平板表格优化、全屏部署弹窗）

## 一键安装

**系统要求：** Ubuntu 22.04 / 24.04 或 Debian 12，root 权限，1GB+ 内存

```bash
bash <(curl -sL https://raw.githubusercontent.com/tripplemay/nextpanel/main/scripts/install.sh)
```

安装脚本将引导你完成：
1. 选择访问方式（域名自动配置 HTTPS，或纯 IP 的 HTTP 访问）
2. 设置管理员账号和密码
3. 自动安装所有依赖（Node.js、PostgreSQL、Nginx、PM2、Xray、sing-box）

安装耗时约 5-10 分钟，取决于服务器配置和网络速度。

## 面板管理

安装完成后，使用 `nextpanel` 命令行工具管理面板：

```bash
nextpanel status              # 查看服务状态和健康检查
nextpanel update              # 更新到最新版本（自动备份数据库）
nextpanel backup              # 手动备份数据库（自动保留最近 5 份）
nextpanel restore <文件>       # 从备份恢复数据库
nextpanel domain set <域名>    # 绑定域名并自动申请 SSL 证书
nextpanel logs [server|web]   # 查看服务日志
nextpanel uninstall           # 卸载 NextPanel
```

### 后续绑定域名

安装时如果选择了纯 IP 模式，后续随时可以绑定域名：

```bash
nextpanel domain set panel.example.com
```

脚本会自动验证 DNS 解析、配置 Nginx、申请 Let's Encrypt 证书并启用自动续期。

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | NestJS 10 (TypeScript) |
| 前端 | Next.js 15 App Router (React 19, Ant Design 5) |
| 数据库 | PostgreSQL 16 + Prisma ORM |
| Agent | Go (systemd 服务) |
| 进程管理 | PM2 |
| 反向代理 | Nginx + Certbot |
| 状态管理 | Zustand + TanStack Query |
| 加密 | AES-256-GCM |

## 系统架构

```
浏览器  -->  Nginx (80/443)
               |
               +-- /api/*  -->  NestJS 后端 (3001)  -->  PostgreSQL
               |
               +-- /*      -->  Next.js 前端 (3400)

被管理服务器  -->  Agent (心跳 + 指标上报)  -->  后端 API
```

## 项目结构

```
nextpanel/
  apps/
    server/           # NestJS 后端（14 个功能模块）
    web/              # Next.js 前端（10 个页面）
    agent/            # Go Agent
  packages/
    shared/           # 共享 TypeScript 枚举和类型
  scripts/
    install.sh        # 一键安装脚本
    nextpanel         # CLI 管理工具
    nginx/            # Nginx 配置模板
```

### 后端模块

Auth, Servers, Nodes, ExternalNodes, Subscriptions, IpCheck, Metrics, Agent, Audit, OperationLog, Cloudflare, Rules, InviteCodes, Users

### 前端页面

| 路由 | 功能 |
|------|------|
| `/servers` | 服务器列表（表格/卡片切换） |
| `/servers/[id]` | 服务器详情（IP 检测、路由测试） |
| `/nodes` | 节点管理（按服务器分组，部署/测试/日志） |
| `/external-nodes` | 外部节点（导入/测试/删除） |
| `/subscriptions` | 订阅管理（创建/编辑/导出/分享） |
| `/audit-logs` | 审计日志（筛选/展开详情） |
| `/settings/cloudflare` | Cloudflare DNS 配置 |
| `/settings/account` | 账户安全（修改密码） |
| `/users` | 用户管理（仅管理员） |
| `/invite-codes` | 邀请码管理（仅管理员） |

## 环境变量

**后端** (`apps/server/.env`)：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `JWT_SECRET` | 64 位十六进制（`openssl rand -hex 32`） |
| `ENCRYPTION_KEY` | 64 位十六进制，AES-256-GCM 加密密钥 |
| `PANEL_URL` | 面板公网地址 |
| `ALLOWED_ORIGIN` | CORS 允许来源 |
| `GITHUB_REPO` | Agent 发布的 GitHub 仓库路径 |
| `GFW_CHECK_FUNCTION_URL` | GFW 封锁检测函数地址（可选，见下方说明） |
| `GFW_CHECK_FUNCTION_TOKEN` | GFW 检测函数认证 Token（可选） |

**前端** (`apps/web/.env.local`)：

| 变量 | 说明 |
|------|------|
| `API_URL` | 后端 API 地址（默认 `http://localhost:3001`） |

## GFW 封锁检测（可选）

IP 检测中的大部分功能（地理位置、流媒体解锁、AI 服务可用性、回程路由测试）安装后即可使用，无需额外配置。

**GFW 封锁检测**是唯一需要额外配置的可选功能。该功能通过部署在中国大陆的 Serverless 函数，从国内测试目标服务器 IP 是否被封锁。不配置此功能不影响其他检测。

### 工作原理

1. 面板向你部署的 Serverless 函数发送 HTTP POST 请求，包含 `{ "ip": "1.2.3.4", "port": 443 }`
2. 函数从中国大陆网络尝试连接目标 IP 和端口
3. 返回 `{ "reachable": true/false, "latency": 150 }`
4. 面板每 6 小时自动对所有服务器执行一次检测

### 配置方式

1. 在中国大陆云平台（腾讯云 SCF、阿里云函数计算、AWS Lambda 中国区等）部署一个 Serverless 函数，实现上述接口
2. 在面板服务器的 `.env` 中添加：

```bash
# 编辑 /opt/apps/nextpanel/apps/server/.env
GFW_CHECK_FUNCTION_URL=https://your-function-url.com/gfw-check
GFW_CHECK_FUNCTION_TOKEN=your-optional-bearer-token    # 可选，用于函数认证
```

3. 重启后端服务：

```bash
pm2 restart nextpanel-server
```

### 函数接口规范

**请求**：`POST` + `Content-Type: application/json`

```json
{ "ip": "1.2.3.4", "port": 443 }
```

**响应**：

```json
{ "reachable": true, "latency": 150 }
```

如配置了 `GFW_CHECK_FUNCTION_TOKEN`，请求会附带 `Authorization: Bearer <token>` 头。

## 本地开发

```bash
# 前置要求：Node.js 20+, pnpm 9+, PostgreSQL

git clone https://github.com/tripplemay/nextpanel.git
cd nextpanel
pnpm install

# 配置环境变量
cp apps/server/.env.example apps/server/.env
# 编辑 .env 填写数据库连接和密钥

# 启动开发服务
pnpm dev    # 后端 (3001) + 前端 (3400) 并行启动

# 其他命令
pnpm build                          # 生产构建
pnpm lint                           # 代码检查
cd apps/server && pnpm test         # 运行测试
cd apps/server && pnpm test:cov     # 测试覆盖率
```

## License

MIT
