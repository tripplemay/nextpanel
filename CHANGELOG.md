# CHANGELOG

所有重要变更均记录于此文件。

---

## [未发布] — 2026-03-04（二）

### 修复：开发/生产数据库隔离

#### 问题

本地开发和生产环境均连接旧库 `nextpanel`，数据未隔离——本地操作直接影响生产数据。

#### 修复

- 为 `nextpanel_dev_user` 和 `nextpanel_prod_user` 重置密码
- 将旧库 `nextpanel` 数据完整迁移至 `nextpanel_prod` 和 `nextpanel_dev`
- 更新生产 `.env`：`DATABASE_URL` 指向 `nextpanel_prod`，重启 PM2
- 更新本地 `.env`：`DATABASE_URL` 指向 `nextpanel_dev`（经 SSH 隧道 5433）
- 旧库 `nextpanel` 保留为备份，不再使用

---

## [未发布] — 2026-03-04

### 节点连通性测试全面升级：TCP 检测 → Xray 端到端代理验证

#### 背景

原有测试仅做 TCP 端口连通检测（`net.createConnection`），只能确认端口"开着"，无法验证 Xray/sing-box 进程是否正常、协议握手是否成功、代理是否真的能让用户翻墙。本次将测试升级为端到端（E2E）验证：在面板服务器本地启动 Xray 客户端，通过 SOCKS5 代理发起真实 HTTP 请求，以 HTTP 204 响应为成功标准。

---

#### 一、CI/CD — 自动部署 Xray 测试客户端

**文件：`.github/workflows/deploy.yml`**

- 在"每次部署都执行"阶段新增幂等 Xray 安装步骤：
  - 检测 `xray` 命令是否已存在，不重复安装
  - 自动识别服务器架构（`x86_64` / `aarch64`），下载对应预编译包
  - 安装至 `/usr/local/bin/xray` 并验证版本
- 本地开发环境：通过 `brew install xray` 安装（`/opt/homebrew/bin/xray`）

---

#### 二、后端 — Xray 测试服务（新增模块）

**新文件：`apps/server/src/nodes/xray-test/config-builder.ts`**

构建 Xray 客户端配置的纯函数模块，支持全部协议组合：

| 协议 | 传输方式 | TLS 模式 |
|------|---------|---------|
| VLESS、VMess、Trojan、Shadowsocks | TCP、WebSocket、gRPC | NONE、TLS（allowInsecure）、REALITY |

- VLESS + REALITY 自动添加 `xtls-rprx-vision` flow
- REALITY 从节点凭证中读取 `realityPublicKey`，使用 `chrome` 指纹

**新文件：`apps/server/src/nodes/xray-test/xray-test.service.ts`**

核心测试服务，完整流程：

1. **信号量**：最多 5 个 Xray 进程并发，超出排队等待
2. **端口分配**：随机选取 20000–29999 范围内的可用 TCP 端口
3. **配置生成**：调用 `buildXrayClientConfig`，写入 `/tmp/xray-test-<uuid>.json`
4. **启动 Xray**：`spawn` 子进程，`stdio: ignore`，异常写入日志
5. **等待就绪**：每 100ms 轮询 SOCKS5 端口，最长等待 1500ms
6. **curl 测试**：`curl --socks5-hostname 127.0.0.1:<port>` 访问 `http://www.gstatic.com/generate_204`，判断响应码是否为 204，记录延迟
7. **清理**：`finally` 块 `SIGKILL` 进程 + 删除临时配置文件

返回结构：`{ reachable, latency, message, testedAt }`

---

#### 三、后端 — 接口改造

**`apps/server/src/nodes/nodes.module.ts`**

- 注册 `XrayTestService` 为 providers

**`apps/server/src/nodes/nodes.service.ts`**

- 删除基于 `net.createConnection` 的旧 `testConnectivity()` 方法及 `net` 模块引入

**`apps/server/src/nodes/nodes.controller.ts`**

- `POST /api/nodes/:id/test`：改为调用 `XrayTestService.testNode()`，接口描述更新为"端到端代理验证"
- 新增 `GET /api/nodes/test-all`（SSE）：
  - 可选 query 参数 `ids`（逗号分隔节点 ID），省略时测试全部节点
  - 事件格式：`{ type: 'result', nodeId, reachable, latency, message, testedAt }` 和 `{ type: 'done', total }`
  - 所有节点测试并发启动，结果实时流式推送，顺序由哪个先完成决定

**`apps/server/src/nodes/nodes.service.spec.ts`**

- 移除已废弃的 `testConnectivity` 测试块及 `net` mock

---

#### 四、前端 — 批量测试 UI

**`apps/web/src/types/api.ts`**

- `ConnectivityResult` 新增 `testedAt: string` 字段

**`apps/web/src/app/(dashboard)/nodes/page.tsx`**

- 表格新增"**连通性**"列：
  - 未测试：灰色 `—`
  - 测试中：`<Spin size="small" />`
  - 成功：绿色 Tag 显示延迟，如 `204ms`
  - 失败：红色 Tag `失败`
- 头部新增"**批量测试**"按钮：
  - 点击启动 SSE 连接至 `/api/nodes/test-all`
  - 按钮文案实时更新为进度，如 `测试中 3/10`
  - 完成后提示"批量测试完成，共 N 个节点"
- 单节点"测试"按钮结果也写入连通性列，与批量共享同一状态
- SSE 流使用与 `useDeployStream` 相同的 `fetch` + `Authorization` header 模式

---

#### 五、错误提示优化

将 curl 原始错误（`Command failed: curl ...`）映射为可读消息：

| curl 退出码 | 显示文案 |
|------------|---------|
| 7 | 节点不可达（代理连接被拒绝或认证失败） |
| 28 | 连接超时（节点无响应） |
| 97 | SOCKS5 代理不可用（Xray 异常退出） |
| 56 | 代理连接被重置 |
| string | curl 启动失败（ENOENT 等） |

---

## [未发布] — 2026-03-02（二）

### 前端视觉统一与布局间距优化

#### 全局样式

- `providers.tsx` 全局 AntD Token 新增 `borderRadius: 8`，所有组件（Card、Input、Tag 等）统一圆角风格

#### PageHeader 组件升级

- 标题行与表格内容之间新增 `Divider` 分隔线（`margin: 12px 0 16px`），移除原来的 `marginBottom: 16` 硬编码间距
- 视觉层次更清晰，标题与数据区域不再粘连

#### 服务器页面重构

- 替换内联 `div + Title + Button` 头部 → 统一使用 `PageHeader` 组件
- 移除本地重复定义的 `Server` 接口和 `statusColor` 常量，改用 `@/types/api` 共享类型
- 状态列从 `Badge + Tag` 组合渲染 → 统一使用 `StatusTag` 共享组件

#### 所有仪表盘页面

| 页面 | 改动 |
|------|------|
| 服务器、节点、模板、订阅、GitHub Actions、审计日志 | `Table size="middle"`（审计日志从 `"small"` 升级） |
| 所有页面 | `Card` 新增 `boxShadow: '0 1px 4px rgba(0,0,0,0.08)'`，在浅灰背景下具有轻微浮起感 |
| 所有页面 | 分页统一显示"共 N 条"汇总 |

---

## [未发布] — 2026-03-02

### 一、审计日志系统全面升级

#### 数据库 Schema 重构

- `OperationLog` 表泛化，去掉节点专用字段，改为通用资源模型：
  - `nodeId / nodeName` → `resourceType / resourceId / resourceName`（支持任意资源类型）
  - `operation` 字段由 `OpType` 枚举改为 `String`（不再受限于固定操作类型）
  - 新增 `correlationId` 字段，与 `AuditLog` 精确关联
  - 删除 `OpType` 枚举；存量数据通过迁移脚本自动回填 `resourceType='node'`
- `AuditLog` 表新增 `correlationId` 字段与对应索引，实现与 `OperationLog` 的双向关联

#### 后端 — `@Audit` 装饰器 + 全局拦截器

- 新建 `@Audit(action, resource)` 方法装饰器，统一声明审计动作
- 新建 `AuditInterceptor` 全局拦截器：
  - 在 handler 执行前生成 `correlationId`，注入 `req.correlationId`
  - handler 返回后自动写入 `AuditLog`，无需 controller 手动调用
  - SSE 流式接口不经过拦截器，保留 controller 内手动写入，并携带 `correlationId`
- 通过 `APP_INTERCEPTOR` 全局注册，一行装饰器即可为任意新接口接入审计

**替换范围：**

| Controller | 改动 |
|-----------|------|
| `ServersController` | CREATE / UPDATE / DELETE / SSH_TEST 全部改用 `@Audit` |
| `NodesController` | CREATE / UPDATE / DELETE / DEPLOY（非 SSE）改用 `@Audit`；SSE 接口手动写入 |
| `TemplatesController` | CREATE / UPDATE / DELETE 全部改用 `@Audit` |
| `PipelinesController` | 新增 CREATE / UPDATE / DELETE 审计（此前无任何审计记录） |

#### 后端 — OperationLog 泛化与独立接口

- `OperationLogService` 支持任意 `resourceType`（'node'、'server' 或未来任意资源）
- 新增查询方法：`listByResource()`、`getByCorrelationId()`（含日志全文）、`getLog()`
- 新建独立 `OperationLogController`，路由从 `nodes` 模块剥离：

| 路由 | 说明 |
|------|------|
| `GET /operation-logs/by-resource/:type/:id` | 资源历史日志 |
| `GET /operation-logs/by-correlation/:correlationId` | 审计日志展开行懒加载 |
| `GET /operation-logs/:id` | 完整日志详情 |

#### 后端 — correlationId 链路打通

- `NodeDeployService` 所有 `finalize()` 和 `doUndeployWithLogs()` 调用均传递 `correlationId`
- `POST /nodes/:id/deploy-stream` 和 `DELETE /nodes/:id/delete-stream` 补录 `action=DEPLOY / DELETE` 审计日志（此前手动部署无审计记录）
- `AuditService.findAll()` 新增 `action` 筛选参数

#### 前端 — 审计日志页面改造

- **动作类型筛选**：Select 下拉框，支持 8 种 action 类型（CREATE / UPDATE / DELETE / LOGIN / LOGOUT / DEPLOY / ROLLBACK / SSH_TEST），切换后自动重置分页
- **展开行**：满足条件的日志行显示展开箭头，点击后展示：
  - 「变更详情」— 格式化 JSON，浅色背景（有 diff 时显示）
  - 「SSH 执行日志」— 深色终端样式，通过 `correlationId` 懒加载（resource=node 且 action 为 CREATE/UPDATE/DELETE/DEPLOY 时显示）
  - 两者均有时同时展示，均无时不显示展开箭头
- `DeployLogModal` 迁移至新的 `/operation-logs/*` 接口，`operation` 字段支持任意字符串显示
- `operationLogsApi` 新增到 `lib/api.ts`；`AuditLog` 与 `OperationLogEntry` 类型同步更新

---

## [未发布] — 2026-03-01

> 本阶段为项目从初始提交到当前状态的完整变更记录，覆盖 CI/CD 部署、代码重构、新功能开发和测试补全四个里程碑。

---

### 一、CI/CD 自动化部署

**功能新增**
- 实现完整的 GitHub Actions 自动部署流程，包含以下步骤：
  - 构建前端（Next.js）与后端（NestJS）
  - 通过 SSH + tar 管道将产物推送至生产服务器
  - 宝塔面板环境下自动配置 Nginx 反向代理与 SSL 证书
  - 使用 pm2 管理 NestJS 进程（`pnpm run start`）
  - 自动初始化 PostgreSQL 数据库并执行 Prisma 迁移

**问题修复**
- 修复 pm2 启动路径：改用 `pnpm run start` 替代直接调用二进制
- 修复 pm2 `--cwd` 参数缺失导致工作目录错误的问题
- 修复宝塔面板 Node.js 24 路径未加载到 PATH 的问题
- 修复 `tsconfig.tsbuildinfo` 缓存导致 TypeScript 增量编译失效的问题
- 修复 `prisma generate` 未在构建前执行导致类型缺失的问题
- 修复 GitHub Actions YAML 中 heredoc 缩进导致的脚本解析错误
- 修复 shared 包缺少 `typescript` devDependency 的编译问题

---

### 二、代码架构重构

**后端 — 文件拆分**
- 将 `config-generator.ts`（264 行）拆分为三个职责单一的模块：
  - `config/xray-config.ts` — Xray/V2Ray 协议配置生成
  - `config/singbox-config.ts` — Sing-box 协议配置生成（含 ss-libev）
  - `config/config-generator.ts` — 工厂函数与协议路由
- 将 `node-deploy.service.ts` 中的 SSH 工具函数提取至 `ssh/ssh.util.ts`：
  - `connectSsh` — 创建 SSH 连接（超时统一为 10s）
  - `uploadText` — 文本内容上传
  - `binaryExists` / `whichBinary` / `detectPackageManager` — 环境探测工具

**后端 — 错误处理**
- 修复所有"fire-and-forget"异步调用（`void xxx()`），改为 `.catch()` 并通过 `Logger` 记录错误：
  - `NodesService.create` → 节点初次部署失败时记录日志
  - `NodesService.update` → 节点重新部署失败时记录日志
  - `NodesService.remove` → 节点下线失败时记录日志
  - `ReleasesService.create` → 发布执行失败时记录日志
- 修复 `deployStream()` 的 catch 块静默吞噬错误的问题，补充错误日志输出
- 为 `TemplatesController` 的 CREATE / UPDATE / DELETE 操作补充审计日志，与其他模块保持一致
- 将内联在 Controller 中的 `CreateSubscriptionDto` 提取至 `dto/create-subscription.dto.ts`

**前端 — TypeScript 类型安全**
- 新建 `src/types/api.ts`，定义所有请求 DTO 与响应类型（Server、Node、Pipeline、Template、Subscription、AuditLog、Metric 等）
- 将 `lib/api.ts` 所有端点从 `unknown` 升级为具体泛型类型

**前端 — 公共组件提取**
- 新建 `components/common/PageHeader.tsx` — 页面标题 + 新增按钮行
- 新建 `components/common/StatusTag.tsx` — 状态标签（颜色映射）
- 新建 `components/common/CopyButton.tsx` — 带复制状态反馈的复制按钮

**前端 — 大页面拆分**
- `nodes/page.tsx`（296 行 → 约 140 行）：
  - 提取 `hooks/useDeployStream.ts` — SSE 流处理逻辑
  - 提取 `components/nodes/DeployDrawer.tsx` — 部署日志抽屉 UI
- `github-actions/page.tsx`（332 行 → 约 180 行）：
  - 提取 `components/pipelines/ConfigDrawer.tsx` — GitHub Actions 配置展示抽屉

**前端 — 补全缺失功能**
- 新建 `components/templates/TemplateFormModal.tsx`，支持模板新增与编辑
- 新建 `components/subscriptions/SubscriptionFormModal.tsx`，支持订阅新增（含节点多选）
- 将两个弹窗接入对应页面，实现完整的 CRUD 流程

---

### 三、新功能 — 节点分享与订阅导出

**后端**
- 新建 `subscriptions/uri-builder.ts`（纯函数，无副作用）：
  - `buildShareUri` — 生成单节点分享 URI（vmess / vless / trojan / ss / socks5 / http）
  - `buildClashProxy` — 生成 Clash/Mihomo YAML 代理条目
  - `buildSingboxOutbound` — 生成 Sing-box 出站配置对象
  - REALITY 协议默认 SNI 与服务端配置保持一致（`www.google.com`）
- 新增 `GET /api/nodes/:id/share` — 返回单节点分享 URI
- 新增 `GET /api/subscriptions/link/:token/clash` — 返回 Clash YAML 订阅内容
- 新增 `GET /api/subscriptions/link/:token/singbox` — 返回 Sing-box JSON 订阅内容

**前端**
- 新建 `components/nodes/NodeShareModal.tsx`：
  - 显示节点分享链接与二维码
  - 含加载中、错误提示（带重试按钮）、协议不支持等状态处理
- 节点列表新增「分享」按钮，点击打开分享弹窗
- 订阅管理页「导出链接」改为多标签页弹窗：
  - V2Ray / Xray Base64 通用格式
  - Clash / Mihomo YAML
  - Sing-box JSON
  - 各格式均可一键复制
- 订阅管理页保留独立的二维码弹窗（Base64 通用格式）

---

### 四、节点表单智能联动

**`NodeFormModal` 全面改造**
- 协议 → 实现联动：选择 SHADOWSOCKS 自动切换实现为 `SS_LIBEV`，其余协议默认 `XRAY`
- 协议 → 凭据字段动态显示：
  - VMESS / VLESS：显示 UUID 输入框
  - TROJAN / SHADOWSOCKS：显示密码输入框
  - SHADOWSOCKS：额外显示加密方式下拉框（6 种预设算法）
- Transport → TLS 联动约束：切换为 QUIC 时，若当前 TLS 为 REALITY 则自动重置为 NONE，且 REALITY 选项从列表中移除
- UUID 一键生成按钮（`crypto.randomUUID()`）
- 监听端口随机生成按钮（10000–60000，避开已用端口）
- 节点名称自动填充：选择服务器后自动推荐 `<服务器名>-N`（N 为当前最小可用编号）
- REALITY 公钥只读展示区，支持一键复制（仅编辑模式且 TLS=REALITY 时显示）
- 修复 Ant Design rc-field-form「循环引用」警告：采用双步 React 状态缓冲模式，所有 `setFieldValue` 通过 `queueMicrotask` 延迟执行

---

### 五、单元测试

**新增 16 个测试文件，共 264 个测试用例**

| 文件 | 测试数 | 覆盖重点 |
|------|--------|---------|
| `crypto.service.spec.ts` | 7 | AES-256-GCM 加解密、篡改检测 |
| `auth.service.spec.ts` | 7 | 登录、注册、token 验证 |
| `agent.service.spec.ts` | 5 | 心跳、节点状态同步 |
| `servers.service.spec.ts` | 11 | CRUD、SSH 密码/密钥连接测试 |
| `nodes.service.spec.ts` | 24 | CRUD、REALITY 密钥生成、分享链接、错误日志 |
| `node-deploy.service.spec.ts` | 10 | 部署/卸载流程、SSE 流、错误处理 |
| `ssh.util.spec.ts` | 10 | SSH 工具函数单元测试 |
| `config-generator.spec.ts` | 8 | 协议路由、二进制命令生成 |
| `xray-config.spec.ts` | 25 | 所有协议、传输、TLS 分支、凭据回退 |
| `singbox-config.spec.ts` | 21 | 所有协议、传输、TLS 分支、凭据回退 |
| `metrics.service.spec.ts` | 6 | 概览统计、时序数据查询 |
| `audit.service.spec.ts` | 5 | 日志写入、分页查询 |
| `subscriptions.service.spec.ts` | 16 | 内容生成（V2Ray/Clash/Singbox）、CRUD |
| `templates.service.spec.ts` | 8 | CRUD、变量占位符渲染 |
| `pipelines.service.spec.ts` | 14 | CRUD、GitHub Actions 配置生成 |
| `releases.service.spec.ts` | 8 | 创建、查询、回滚、执行错误捕获 |

**最终覆盖率**

| 指标 | 覆盖率 |
|------|--------|
| 语句覆盖（Statements） | 87.7% |
| 分支覆盖（Branches） | 82.4% |
| 函数覆盖（Functions） | 94.1% |
| 行覆盖（Lines） | 88.7% |

---

### 六、其他改进

- 前端各页面 `useQuery` 补充 `isError` 处理（servers、audit-logs、templates）
- 各页面 `useMutation` 补充 `onError` 回调（servers deleteMutation）
- `apps/web/package.json` 新增 `dev:clean` 脚本（`rimraf .next && next dev`）
- `.next` 缓存清理流程文档化，避免 webpack 模块缓存损坏问题
