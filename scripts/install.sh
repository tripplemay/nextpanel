#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
#  NextPanel — 一键安装脚本
#  支持系统：Ubuntu 22.04 / 24.04、Debian 12
# ============================================================================

APP_DIR="/opt/apps/nextpanel"
LOG_DIR="/var/log/nextpanel"
BACKUP_DIR="/opt/backups/nextpanel"
REPO_URL="https://github.com/tripplemay/nextpanel.git"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[信息]${NC} $*"; }
ok()    { echo -e "${GREEN}[完成]${NC} $*"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $*"; }
fail()  { echo -e "${RED}[错误]${NC} $*"; exit 1; }

# ── 步骤 1：环境预检 ────────────────────────────────────────────────────

echo ""
echo "=========================================="
echo "        NextPanel 一键安装脚本            "
echo "=========================================="
echo ""

[ "$EUID" -eq 0 ] || fail "请以 root 用户运行：sudo bash install.sh"

if ! command -v apt-get &>/dev/null; then
  fail "本脚本仅支持 Debian/Ubuntu 系统（未检测到 apt-get）"
fi

# 检查操作系统兼容性
if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "$ID-$VERSION_ID" in
    ubuntu-22.04|ubuntu-24.04|debian-12) ok "检测到 $PRETTY_NAME" ;;
    *) warn "未经测试的系统：$PRETTY_NAME，继续安装..." ;;
  esac
fi

# ── 步骤 2：收集用户输入 ────────────────────────────────────────────────

echo ""
echo "请选择访问方式："
echo "  1) 使用域名（推荐，自动配置 HTTPS）"
echo "  2) 使用 IP 直接访问（HTTP）"
echo ""
read -rp "请输入 [1/2]：" MODE_CHOICE

MODE="IP"
DOMAIN=""
CERTBOT_EMAIL=""

if [ "$MODE_CHOICE" = "1" ]; then
  MODE="DOMAIN"
  echo ""
  read -rp "请输入域名（需提前将 A 记录指向本机 IP）：" DOMAIN
  [ -n "$DOMAIN" ] || fail "域名不能为空"

  while true; do
    read -rp "请输入邮箱（用于 SSL 证书申请）：" CERTBOT_EMAIL
    if [[ "$CERTBOT_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
      break
    fi
    warn "邮箱格式无效，请重新输入"
  done

  # 验证 DNS 解析
  info "正在验证 DNS 解析..."
  SERVER_IP=$(hostname -I | awk '{print $1}')
  RESOLVED_IP=$(dig +short "$DOMAIN" 2>/dev/null | head -1)
  if [ "$RESOLVED_IP" = "$SERVER_IP" ]; then
    ok "DNS 验证通过：$DOMAIN -> $SERVER_IP"
  else
    warn "DNS 不匹配：$DOMAIN 解析到 ${RESOLVED_IP:-无结果}，本机 IP 为 $SERVER_IP"
    read -rp "是否继续？[y/N]：" DNS_CONTINUE
    [ "$DNS_CONTINUE" = "y" ] || [ "$DNS_CONTINUE" = "Y" ] || fail "已取消安装"
  fi
fi

echo ""
echo "设置管理员账号："
read -rp "管理员用户名 [admin]：" ADMIN_USER
ADMIN_USER="${ADMIN_USER:-admin}"

while true; do
  read -rsp "管理员密码（至少 8 位）：" ADMIN_PASS
  echo ""
  if [ "${#ADMIN_PASS}" -lt 8 ]; then
    warn "密码长度不足 8 位"
    continue
  fi
  read -rsp "确认密码：" ADMIN_PASS_CONFIRM
  echo ""
  if [ "$ADMIN_PASS" != "$ADMIN_PASS_CONFIRM" ]; then
    warn "两次密码不一致"
    continue
  fi
  break
done

echo ""
info "开始安装..."
echo ""

# ── 步骤 3：系统更新 ────────────────────────────────────────────────────

info "正在更新系统软件包..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
ok "系统更新完成"

# ── 步骤 4：安装基础工具 ────────────────────────────────────────────────

info "正在安装基础工具..."
apt-get install -y -qq curl git openssl build-essential python3 wget unzip dnsutils > /dev/null
ok "基础工具安装完成"

# ── 步骤 5：安装 Node.js 20 ─────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  info "正在安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null
fi

# 校验 Node.js 版本
NODE_MAJOR=$(node --version | cut -dv -f2 | cut -d. -f1)
[ "$NODE_MAJOR" -ge 18 ] || fail "需要 Node.js 18+，当前版本：$(node --version)"
ok "Node.js $(node --version)"

# ── 步骤 6：安装 pnpm 和 PM2 ────────────────────────────────────────────

if ! command -v pnpm &>/dev/null; then
  info "正在安装 pnpm..."
  npm install -g pnpm@latest > /dev/null 2>&1
fi

if ! command -v pm2 &>/dev/null; then
  info "正在安装 PM2..."
  npm install -g pm2@latest > /dev/null 2>&1
fi
ok "pnpm $(pnpm --version)，PM2 $(pm2 --version | head -1)"

# ── 步骤 7：安装 PostgreSQL ──────────────────────────────────────────────

if ! command -v psql &>/dev/null; then
  info "正在安装 PostgreSQL..."
  apt-get install -y -qq postgresql postgresql-contrib > /dev/null
  systemctl enable postgresql > /dev/null 2>&1
  systemctl start postgresql
fi

# 校验 PostgreSQL 版本
PG_MAJOR=$(psql --version | awk '{print $3}' | cut -d. -f1)
[ "$PG_MAJOR" -ge 12 ] || fail "需要 PostgreSQL 12+，当前版本：$PG_MAJOR"
ok "PostgreSQL $(psql --version | awk '{print $3}')"

# ── 步骤 8：初始化数据库 ────────────────────────────────────────────────

info "正在初始化数据库..."
DB_PASS=$(openssl rand -hex 16)

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='nextpanel'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER nextpanel WITH PASSWORD '$DB_PASS';" > /dev/null

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='nextpanel'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE nextpanel OWNER nextpanel;" > /dev/null

sudo -u postgres psql -c "ALTER USER nextpanel WITH PASSWORD '$DB_PASS';" > /dev/null 2>&1
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE nextpanel TO nextpanel;" > /dev/null 2>&1
ok "数据库就绪"

# ── 步骤 9：安装 Nginx ───────────────────────────────────────────────────

if ! command -v nginx &>/dev/null; then
  info "正在安装 Nginx..."
  apt-get install -y -qq nginx > /dev/null
  systemctl enable nginx > /dev/null 2>&1
  systemctl start nginx
fi
ok "Nginx $(nginx -v 2>&1 | awk -F/ '{print $2}')"

# ── 步骤 10：安装 Certbot ────────────────────────────────────────────────

if ! command -v certbot &>/dev/null; then
  info "正在安装 Certbot..."
  apt-get install -y -qq certbot python3-certbot-nginx > /dev/null
fi
ok "Certbot 已安装"

# ── 步骤 11：创建目录结构 ────────────────────────────────────────────────

mkdir -p "$LOG_DIR" "$BACKUP_DIR"
chmod 755 "$LOG_DIR"

# ── 步骤 12：克隆代码仓库 ────────────────────────────────────────────────

if [ ! -d "$APP_DIR/.git" ]; then
  info "正在克隆 NextPanel 代码仓库..."
  git clone --depth 1 "$REPO_URL" "$APP_DIR" > /dev/null 2>&1 || fail "代码仓库克隆失败"
  ok "代码仓库克隆完成"
else
  info "代码仓库已存在，正在拉取最新代码..."
  cd "$APP_DIR"
  git fetch origin main --depth 1 > /dev/null 2>&1
  git reset --hard origin/main > /dev/null 2>&1
  ok "代码已更新"
fi

# ── 步骤 13：生成密钥并写入配置 ──────────────────────────────────────────

info "正在生成密钥..."
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
SERVER_IP=$(hostname -I | awk '{print $1}')

if [ "$MODE" = "DOMAIN" ]; then
  PANEL_URL="https://$DOMAIN"
  ALLOWED_ORIGIN="https://$DOMAIN"
else
  PANEL_URL="http://$SERVER_IP"
  ALLOWED_ORIGIN="http://$SERVER_IP"
fi

cat > "$APP_DIR/apps/server/.env" <<EOF
DATABASE_URL="postgresql://nextpanel:${DB_PASS}@localhost:5432/nextpanel"
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="7d"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"
PORT=3001
ALLOWED_ORIGIN="${ALLOWED_ORIGIN}"
PANEL_URL="${PANEL_URL}"
GITHUB_REPO="tripplemay/nextpanel-releases"
EOF

chmod 600 "$APP_DIR/apps/server/.env"
ok "配置文件已写入"

# ── 步骤 14：配置 Nginx ──────────────────────────────────────────────────

info "正在配置 Nginx..."

# 检测已有 Nginx 配置是否冲突
if [ "$MODE" = "DOMAIN" ]; then
  CONFLICT=$(grep -rl "server_name.*$DOMAIN" /etc/nginx/sites-enabled/ 2>/dev/null | grep -v nextpanel || true)
  if [ -n "$CONFLICT" ]; then
    warn "域名 $DOMAIN 已存在于其他配置中：$CONFLICT"
    warn "正在禁用冲突配置以避免路由问题..."
    for f in $CONFLICT; do
      rm -f "$f"
      ok "已禁用：$f"
    done
  fi
  sed "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" "$APP_DIR/scripts/nginx/domain.conf" \
    > /etc/nginx/sites-available/nextpanel
else
  sed "s/IP_PLACEHOLDER/$SERVER_IP/g" "$APP_DIR/scripts/nginx/ip.conf" \
    > /etc/nginx/sites-available/nextpanel
fi

ln -sf /etc/nginx/sites-available/nextpanel /etc/nginx/sites-enabled/
nginx -t > /dev/null 2>&1 || fail "Nginx 配置测试失败"
systemctl reload nginx
ok "Nginx 配置完成"

# ── 步骤 15：创建 Swap（低内存保护）──────────────────────────────────────

TOTAL_MEM_MB=$(free -m | awk '/^Mem/ {print $2}')
if [ "$TOTAL_MEM_MB" -lt 4096 ] && [ ! -f /swapfile ]; then
  info "检测到低内存（${TOTAL_MEM_MB}MB），正在创建 2GB Swap..."
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap 创建完成"
fi

# ── 步骤 16：安装项目依赖 ────────────────────────────────────────────────

info "正在安装项目依赖（可能需要几分钟）..."
cd "$APP_DIR"
pnpm install --no-frozen-lockfile > /dev/null 2>&1
cd "$APP_DIR/apps/server"
pnpm exec prisma generate > /dev/null 2>&1
ok "项目依赖安装完成"

# ── 步骤 17：编译构建 ────────────────────────────────────────────────────

info "正在编译构建（可能需要几分钟）..."
export NODE_OPTIONS="--max-old-space-size=1024"
export NEXT_TELEMETRY_DISABLED=1
BUILD_LOG="/tmp/nextpanel-build.log"

# 逐个构建，确保每步都成功
cd "$APP_DIR/packages/shared" && pnpm build >> "$BUILD_LOG" 2>&1 || true

cd "$APP_DIR/apps/server" && pnpm build >> "$BUILD_LOG" 2>&1
if [ ! -f "$APP_DIR/apps/server/dist/main.js" ] || [ ! -s "$APP_DIR/apps/server/dist/main.js" ]; then
  echo "--- 构建日志 ---"
  tail -30 "$BUILD_LOG"
  fail "后端编译失败：dist/main.js 不存在或为空"
fi
ok "后端编译完成"

cd "$APP_DIR/apps/web" && pnpm build >> "$BUILD_LOG" 2>&1
if [ ! -d "$APP_DIR/apps/web/.next" ]; then
  echo "--- 构建日志 ---"
  tail -30 "$BUILD_LOG"
  fail "前端编译失败：.next 目录不存在"
fi
ok "前端编译完成"

rm -f "$BUILD_LOG"
unset NODE_OPTIONS NEXT_TELEMETRY_DISABLED

# ── 步骤 18：执行数据库迁移 ──────────────────────────────────────────────

info "正在执行数据库迁移..."
cd "$APP_DIR/apps/server"
MIGRATE_OUTPUT=$(pnpm exec prisma migrate deploy 2>&1) || {
  echo "$MIGRATE_OUTPUT"
  fail "数据库迁移失败"
}
ok "数据库迁移完成"

# ── 步骤 19：创建管理员账号 ──────────────────────────────────────────────

info "正在创建管理员账号..."
cd "$APP_DIR/apps/server"
pnpm exec ts-node -r tsconfig-paths/register prisma/seed.ts "$ADMIN_USER" "$ADMIN_PASS" > /dev/null 2>&1
ok "管理员账号创建成功"

# ── 步骤 20：启动服务 ────────────────────────────────────────────────────

info "正在启动服务..."
cd "$APP_DIR"
pm2 delete nextpanel-server nextpanel-web > /dev/null 2>&1 || true
pm2 start ecosystem.config.cjs > /dev/null 2>&1

# 注册 PM2 开机自启
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -n 1 | bash > /dev/null 2>&1 || true
pm2 save > /dev/null 2>&1
ok "服务启动完成"

# ── 步骤 21：健康检查 ────────────────────────────────────────────────────

info "正在验证服务就绪..."

# 等待后端启动
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3001/api/docs > /dev/null 2>&1; then
    ok "后端服务就绪"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "后端服务启动超时，请检查日志：pm2 logs nextpanel-server"
  fi
  sleep 1
done

# 等待前端启动
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/ > /dev/null 2>&1; then
    ok "前端服务就绪"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "前端服务启动超时，请检查日志：pm2 logs nextpanel-web"
  fi
  sleep 1
done

# ── 步骤 22：申请 SSL 证书（域名模式）────────────────────────────────────

if [ "$MODE" = "DOMAIN" ]; then
  info "正在申请 SSL 证书..."
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" > /dev/null 2>&1; then
    systemctl enable certbot.timer > /dev/null 2>&1 || true
    ok "SSL 证书已安装（已启用自动续期）"
  else
    warn "SSL 证书申请失败，面板暂时通过 HTTP 访问。稍后可执行 'nextpanel domain set $DOMAIN' 重试。"
  fi
fi

# ── 步骤 23：安装 Xray 和 sing-box（可选）─────────────────────────────────

ARCH=$(uname -m | sed 's/x86_64/64/;s/aarch64/arm64-v8a/')
if ! command -v xray &>/dev/null; then
  info "正在安装 Xray 测试客户端..."
  if curl -fsSL "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${ARCH}.zip" -o /tmp/xray.zip 2>/dev/null; then
    unzip -oq /tmp/xray.zip xray -d /usr/local/bin/ 2>/dev/null && chmod +x /usr/local/bin/xray
    rm -f /tmp/xray.zip
    ok "Xray 已安装"
  else
    warn "Xray 安装失败（可选组件，节点连通性测试将不可用）"
  fi
fi

SB_ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
if ! command -v sing-box &>/dev/null; then
  info "正在安装 sing-box 测试客户端..."
  SB_TAG=$(curl -sf "https://api.github.com/repos/SagerNet/sing-box/releases/latest" 2>/dev/null | grep '"tag_name"' | head -1 | sed 's/.*"\(v[^"]*\)".*/\1/')
  if [ -n "$SB_TAG" ]; then
    if curl -fsSL "https://github.com/SagerNet/sing-box/releases/download/${SB_TAG}/sing-box-${SB_TAG#v}-linux-${SB_ARCH}.tar.gz" -o /tmp/sb.tar.gz 2>/dev/null; then
      tar xzf /tmp/sb.tar.gz -C /tmp/ 2>/dev/null
      mv /tmp/sing-box-*/sing-box /usr/local/bin/sing-box 2>/dev/null && chmod +x /usr/local/bin/sing-box
      rm -rf /tmp/sb.tar.gz /tmp/sing-box-*/
      ok "sing-box 已安装"
    else
      warn "sing-box 安装失败（可选组件，Hysteria2 测试将不可用）"
    fi
  fi
fi

# ── 步骤 24：配置日志轮转 ────────────────────────────────────────────────

cat > /etc/logrotate.d/nextpanel <<'LOGROTATE'
/var/log/nextpanel/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
LOGROTATE
ok "日志轮转已配置"

# ── 步骤 25：安装 CLI 管理工具 ───────────────────────────────────────────

info "正在安装 nextpanel 命令行工具..."
cp "$APP_DIR/scripts/nextpanel" /usr/local/bin/nextpanel
chmod +x /usr/local/bin/nextpanel
ok "命令行工具已安装"

# ── 安装完成 ─────────────────────────────────────────────────────────────

echo ""
echo "=========================================="
echo -e "  ${GREEN}NextPanel 安装完成！${NC}"
echo "=========================================="
echo ""
if [ "$MODE" = "DOMAIN" ]; then
  echo -e "  面板地址：${CYAN}https://$DOMAIN${NC}"
else
  echo -e "  面板地址：${CYAN}http://$SERVER_IP${NC}"
fi
echo ""
echo "  管理员用户名：$ADMIN_USER"
echo "  管理员密码：[安装时设置的密码]"
echo ""
echo "  常用管理命令："
echo "    nextpanel status      查看服务状态"
echo "    nextpanel update      更新到最新版本"
echo "    nextpanel backup      备份数据库"
echo "    nextpanel logs        查看日志"
echo "    nextpanel domain set  绑定域名并申请 SSL 证书"
echo ""
echo "  服务状态："
pm2 list
echo ""
