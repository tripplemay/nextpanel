# 新机器开发环境配置指南

本项目使用远程 PostgreSQL 开发库（托管在 VPS 上），所有开发机器共享同一份数据，无需手动同步。

## 前置条件

- 已安装 Node.js >= 20、pnpm >= 9
- 已有项目代码（`git clone` 或 `git pull`）
- 持有数据库连接凭据（向项目维护者获取）

---

## 第一步：配置 SSH 密钥

SSH 密钥用于建立到 VPS 数据库的加密隧道，**二选一**：

### 方式 A：从已有机器复制密钥（推荐）

将已配置机器上的 `~/.ssh/nextpanel_db` 和 `~/.ssh/nextpanel_db.pub` 安全地复制到新机器的相同路径，然后设置权限：

```bash
chmod 600 ~/.ssh/nextpanel_db
```

### 方式 B：生成新密钥并授权

在新机器上生成专用密钥：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/nextpanel_db -N "" -C "nextpanel-db-tunnel"
```

将新公钥追加到 VPS 的 `~/.ssh/authorized_keys`：

```bash
ssh-copy-id -i ~/.ssh/nextpanel_db.pub root@<VPS_IP>
```

---

## 第二步：配置 SSH 隧道

在 `~/.ssh/config` 末尾追加以下内容（替换 `<VPS_IP>`）：

```
Host nextpanel-db
    HostName <VPS_IP>
    User root
    IdentityFile ~/.ssh/nextpanel_db
    LocalForward 5433 localhost:5432
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

验证连接是否正常：

```bash
ssh -N -f nextpanel-db && nc -z localhost 5433 && echo "隧道正常"
```

---

## 第三步：配置环境变量

在 `apps/server/.env` 中设置以下内容（向项目维护者获取实际密码）：

```bash
DATABASE_URL="postgresql://nextpanel_dev_user:<DB_DEV_PASS>@localhost:5433/nextpanel_dev"
JWT_SECRET="<JWT_SECRET>"
JWT_EXPIRES_IN="7d"
ENCRYPTION_KEY="<ENCRYPTION_KEY>"
PORT=3001
ALLOWED_ORIGIN="http://localhost:3000"
```

在 `apps/web/.env.local` 中设置：

```bash
API_URL=http://localhost:3001
```

---

## 第四步：初始化数据库

**仅首次配置时执行**（后续 git pull 无需重复）：

```bash
cd apps/server

# 应用所有数据库迁移
pnpm exec prisma migrate deploy

# 创建 admin 用户（如果远程库已有数据则跳过）
pnpm seed admin <你的密码>
```

---

## 第五步：启动开发

```bash
# 在项目根目录
pnpm dev
```

`pnpm dev` 会自动检查 SSH 隧道是否运行，若未运行则自动启动，无需手动操作。

---

## 日常工作流

```bash
git pull        # 同步最新代码
pnpm dev        # 启动开发（隧道自动处理）
```

如有新迁移文件，运行一次：

```bash
cd apps/server && pnpm exec prisma migrate deploy
```

---

## 故障排查

**隧道连接失败**

```bash
# 检查隧道进程
lsof -i :5433

# 手动重启隧道
pkill -f "ssh.*nextpanel-db"; ssh -N -f nextpanel-db
```

**数据库连接被拒绝**

- 确认 SSH 隧道正在运行（5433 端口可用）
- 确认 `DATABASE_URL` 中的用户名和密码正确
- 确认 VPS 上 PostgreSQL 服务在运行：`systemctl status postgresql`
