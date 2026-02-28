# 需求描述

nextpanel：一站式管理多协议代理服务器群的面板

### 目标与范围

- **目标**：提供一个统一入口，集中管理多台代理服务器/节点（多地域、多提供商、多协议配置），实现部署、配置、监控、审计、告警与运维自动化。
- **覆盖协议（需求）**：除 v2ray/xray 体系外，需要支持主流代理协议，并能统一抽象为「节点」进行管理与分发，例如：
    - VMess / VLESS / Trojan（v2ray/xray）
    - Shadowsocks（含常见插件/UDP 等能力按实现分期）
    - SOCKS5
    - HTTP(S) 代理（含 CONNECT）
    
    -（可选）Hysteria2 / TUIC 等新协议按后续优先级加入
    
- **适用对象**：个人自建与小团队运维；可逐步扩展到多租户。
- **非目标（v1 不做）**：商业级计费体系、复杂的代理链路编排、全量自动化合规报表。

### 关键使用场景（User Stories）

- 作为管理员，希望只需在面板中填写服务器 IP 与登录信息，其余安装、配置、发布、回滚等操作均由面板自动完成。
- 作为管理员，希望一键新增服务器节点，自动完成系统初始化与代理服务安装（按所选协议/实现）。
- 作为管理员，希望批量下发/回滚配置，并且可灰度发布。
- 作为管理员，希望看到全局与单节点的在线情况、延迟、流量、失败率，并能告警。
- 作为管理员，希望对每次变更有审计记录，支持谁在什么时间改了什么。
- 作为用户（必须），希望生成订阅链接/二维码，按策略分组下发节点，且订阅格式可适配主流客户端生态（按协议类型输出）。

### 功能拆解（按模块）

#### 1) 资产与拓扑

- 服务器资产管理：区域、提供商、IP、SSH 端口、系统信息、标签、备注
- 节点分组：按地区、用途（流媒体/低延迟/备用）、权重、可用性
- 依赖管理：域名、证书、出口 IP 池（可选）

#### 2) 连接与安全

- SSH 连接管理：密钥/跳板机/连接测试
- 权限模型：管理员、运维、只读（v2 可加多租户与项目空间）
- 密钥与凭证库：加密存储、轮换、最小权限

#### 3) 部署与配置管理（核心）

- 一键安装：选择发行版与安装方式（脚本/Ansible/Agent）
- **协议与实现适配层（关键）**：
    - 统一节点抽象：protocol / transport / tls / credentials / listen / routing 等
    - 不同协议背后的实现可选：xray/v2ray、shadowsocks-libev、sing-box、hysteria 等（按你的技术路线确定）
    - 同一协议可能有多实现（例如 SS），面板需在模板层明确「协议 + 实现」组合
- 配置模板：按协议类型（VMess/VLESS/Trojan/Shadowsocks/SOCKS5/HTTP CONNECT 等）、传输（TCP/WS/gRPC/QUIC 等按实现）、TLS/Reality（按你的方案）
- 配置渲染：变量（域名、端口、UUID/密码、加密方法、路由规则）与校验（JSON schema 或自定义校验器）
- 发布策略：
    - 单机发布
    - 批量发布（选择节点/标签）
    - 灰度发布（分批、失败停止、自动回滚）
- 版本与回滚：每次发布生成版本快照，支持一键回滚
- 健康检查：发布后自动探活（端口、握手、HTTP 探测、可选真实链路探测）

#### 4) 订阅与客户端分发（必须）

- 订阅管理：按用户/分组生成订阅链接
- 节点策略：仅推送可用节点、按地域优先、按权重随机
- 输出适配：
    - 根据节点协议输出对应订阅条目（例如 SS、VLESS、Trojan 等各自 URI）
    - 支持常见聚合订阅格式（可先做最小集：一类通用格式 + 若干客户端兼容输出）
- 二维码与一次性链接（可选）

#### 5) 监控与告警

- 指标：CPU/内存/磁盘/网络、进程存活、端口可达、延迟、丢包（可选）
- 业务指标：连接数、流量、失败率（如果能从日志/metrics 获取）
- 告警：Webhook/邮件/企业微信/飞书（先预留接口）
- 事件中心：告警聚合、静默、确认、恢复

#### 6) 日志与审计

- 操作审计：登录、变更、发布、回滚、密钥访问
- 节点日志：安装/发布日志、代理服务日志聚合（可选）
- 追踪：一次发布的全链路执行记录

### 系统架构建议

#### 架构方案 A：无 Agent（SSH/Ansible）

- 控制面（Panel）通过 SSH 或 Ansible 对节点执行安装与发布
- 优点：节点侧改动少，上手快
- 缺点：并发、网络复杂度、审计与指标采集受限

#### 架构方案 B：轻量 Agent + 控制面（推荐）

- 每台节点运行一个轻量 Agent：
    - 拉取配置与发布指令
    - 上报心跳与指标
    - 本地保留配置版本，支持回滚
- 优点：可控性强、可扩展、网络穿透更容易
- 缺点：需要维护 Agent 版本与升级

### 技术选型（可落地）

- 前端：Vue3/React + Ant Design/Naive UI
- 后端：Go（Gin/Fiber）或 Node.js（NestJS）
- 数据库：PostgreSQL（配置版本、审计日志适合）
- 消息队列：NATS/RabbitMQ（发布任务与回调）
- 任务调度：内置 worker + 队列；或 Temporal（高级）
- 监控：Prometheus + Grafana（可选），Panel 内置简版仪表盘
- 机密管理：KMS（可选）或本地加密（AES-GCM + 主密钥）

### 数据模型草案（表/实体）

- Server：id、name、region、provider、ip、sshAuth、tags、status
- Node：
    - serverId
    - protocol（vmess/vless/trojan/ss/socks5/http 等）
    - implementation（xray/sing-box/ss-libev 等，可空）
    - transport（tcp/ws/grpc 等，可空）
    - tls（none/tls/reality 等）
    - listen/port
    - domain（可空）
    - credentials（uuid/password/method 等按协议）
    - enabled
- Template：name、protocol、implementation、content、variables、createdBy
- Release：id、templateId、targets、strategy、status、createdAt
- ReleaseStep：releaseId、serverId、status、log、startedAt、endedAt
- ConfigSnapshot：nodeId、version、content、checksum、createdAt
- AlertRule / AlertEvent
- AuditLog：actor、action、resource、diff、timestamp、ip

### API 草案（示例）

- POST /servers（新增资产）
- POST /servers/:id/test-ssh（连通性测试）
- POST /nodes（新增节点，指定协议/实现/模板）
- POST /templates（创建模板）
- POST /releases（创建发布任务）
- POST /releases/:id/rollback（回滚）
- GET /metrics/overview（全局概览）
- GET /audit-logs（审计查询）

### 里程碑（建议按 3 个版本）

- **MVP（2-4 周）**：资产管理 + SSH 安装 + 单协议（优先 xray/v2ray 体系）单机发布 + 基础监控（存活/端口）+ 审计
- **v1（4-8 周）**：多协议扩展（至少补齐 Shadowsocks + SOCKS5/HTTP 其一）+ 批量发布 + 灰度 + 版本回滚 + 告警 + 配置模板体系完善
- **v2（8-12 周）**：Agent 化、订阅分发的多格式适配、权限细化、指标与日志聚合

### 风险与注意事项

- 合规与滥用风险：建议默认关闭对外公开注册，限制订阅分享与速率
- 凭证安全：SSH 私钥与订阅密钥必须加密存储，支持轮换
- 发布可靠性：必须有幂等与回滚策略，避免半发布状态
- 兼容性风险：多协议/多实现会带来配置差异与订阅格式差异，建议从「协议 + 实现」组合最小集开始，逐步扩展

### 需要你确认的 6 个关键问题

1. 你希望采用 **SSH/Ansible** 还是 **Agent** 方案优先？
    - 已确认：**Agent 方案优先** ✅
2. 节点规模预期：10 台以内，还是 100+？
    - 已确认：**10 台以内** ✅
3. 需要多租户吗？是否要给不同人隔离不同的节点组？
    - 已确认：**不需要多租户** ✅
4. 订阅分发是否必须做？还是只做运维面板即可？
    - 已确认：**必须做** ✅
5. 监控指标优先级：仅存活与端口（已确认） ✅
6. 部署环境：面板运行在公网 VPS，还是内网机器？
    - 已确认：**部署在公网 VPS** ✅

###