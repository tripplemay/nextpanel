# 服务器页面优化需求文档

> 沟通日期：2026-03-02

---

## 背景

对现有服务器管理页面进行功能优化，本次沟通确定了以下三个方向的需求：

- **第 2 点**：数据自动刷新
- **第 3 点**：Agent Token 管理
- **第 6 点**：Agent 安装引导

---

## 需求详情

### 第 2 点 — 数据自动刷新

- 每 **10 秒**自动刷新服务器列表
- **纯静默刷新**，界面上无任何提示（无"上次更新时间"、无转动图标、无手动刷新按钮）
- 刷新范围：整个服务器列表（包括状态、指标、以及新增/删除的服务器）

---

### 第 3 点 — Agent Token 管理

**Token 用途：**
- 用于配置 Agent 时粘贴到 Agent 配置文件，无其他用途

**展示方式：**
- 操作列新增「Token」按钮
- 点击后弹出对话框，显示 Token 内容 + 一键复制按钮

**Token 是否可更换：**
- **不需要**。最初误以为 Token 是第三方 API Key 才提出更换需求，确认 Token 是项目内部认证凭据后，取消此需求
- Token 固定不变，无重新生成功能，无续期机制

---

### 第 6 点 — Agent 安装引导

#### Agent 程序

- **语言**：Go
- **代码位置**：放在当前 monorepo 的 `apps/agent/` 目录下
- **功能**：
  - 采集系统指标（CPU / 内存 / 磁盘 / 网络）
  - 每 10 秒向面板后端发送心跳（`POST /api/agent/heartbeat`）
  - 以 systemd 服务形式长期运行
- **配置文件**：`/etc/nextpanel/agent.json`，包含 `serverUrl` 和 `agentToken`
- **目标平台**：Linux（x86_64 和 ARM64）

#### 分发方式

- 将 GitHub 仓库改为 **Public**
- 推送 `agent/v*` 格式的 tag 时，**GitHub Actions 自动编译**并发布到 **GitHub Releases**
- 编译目标：`linux/amd64` 和 `linux/arm64`

#### 安装触发时机

- 在面板**新增服务器后**，自动通过 SSH 检测目标服务器上是否已安装 Agent
- 如未安装，自动执行安装流程（无需用户手动操作）

#### 安装过程 UI

- 新增服务器成功后，自动弹出「Agent 安装」抽屉
- 抽屉内显示**实时终端输出**（SSE 流式推送）

#### 安装失败处理

- 终端输出中显示具体报错信息，便于用户排查
- 提供**重试按钮**，可一键重新触发安装
- 提供**手动安装命令**（可复制），用户可自行 SSH 到目标服务器执行

---

## 开发方案

### Phase 1 — 数据自动刷新（小改动）

| 文件 | 改动内容 |
|------|---------|
| `apps/web/src/app/(dashboard)/servers/page.tsx` | `useQuery` 增加 `refetchInterval: 10_000` |

---

### Phase 2 — Agent Token 弹窗

| 文件 | 改动内容 |
|------|---------|
| `apps/web/src/types/api.ts` | `Server` 接口补充 `agentToken: string` 字段 |
| `apps/web/src/components/servers/AgentTokenModal.tsx` | 新建：Token 展示 + 复制按钮 |
| `apps/web/src/app/(dashboard)/servers/page.tsx` | 操作列新增 Token 按钮，点击打开弹窗 |

---

### Phase 3 — Go Agent 程序

新建目录 `apps/agent/`，包含：

| 文件 | 内容 |
|------|------|
| `go.mod` | 依赖管理，使用 `gopsutil` 采集系统指标 |
| `main.go` | 主循环：每 10 秒采集指标并发送心跳 |
| `config.go` | 读取 `/etc/nextpanel/agent.json` |
| `metrics.go` | CPU / 内存 / 磁盘 / 网络数据采集 |

---

### Phase 4 — GitHub Actions 自动发布

| 文件 | 内容 |
|------|------|
| `.github/workflows/agent-release.yml` | 监听 `agent/v*` tag，编译双架构二进制并发布到 GitHub Releases |

---

### Phase 5 — 后端：Agent 安装接口

| 文件 | 改动内容 |
|------|---------|
| `apps/server/.env` | 新增 `PANEL_URL`（面板对外访问地址，Agent 用于发心跳） |
| `apps/server/src/servers/servers.controller.ts` | 新增 `GET /:id/install-agent` SSE 端点 |
| `apps/server/src/servers/servers.service.ts` | 新增 `installAgentStream()`：SSH 进目标服务器 → 检测是否已安装 → 执行安装脚本 → 实时推送输出 |

安装脚本由后端拼装后通过 SSH 内联执行，流程：
1. 检测架构（amd64 / arm64）
2. 从 GitHub Releases 下载对应二进制
3. 写入 `/etc/nextpanel/agent.json` 配置文件
4. 注册并启动 systemd 服务

---

### Phase 6 — 前端：Agent 安装抽屉

| 文件 | 改动内容 |
|------|---------|
| `apps/web/src/components/servers/AgentInstallDrawer.tsx` | 新建：SSE 终端输出 + 失败时显示重试按钮和手动安装命令 |
| `apps/web/src/app/(dashboard)/servers/page.tsx` | 新增服务器成功后自动打开安装抽屉 |

---

## 实施顺序

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
```

- Phase 1、2 可立即完成（纯前端改动）
- Phase 3、4 是 Agent 程序本体，需先完成才能联调安装流程
- Phase 5、6 依赖 Phase 3、4 完成后才能端到端测试
