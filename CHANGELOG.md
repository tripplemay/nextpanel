# CHANGELOG

所有重要变更均记录于此文件。

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
