#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
#  NextPanel — One-Click Install Script
#  Supported: Ubuntu 22.04 / 24.04, Debian 12
# ============================================================================

APP_DIR="/opt/apps/nextpanel"
LOG_DIR="/var/log/nextpanel"
BACKUP_DIR="/opt/backups/nextpanel"
REPO_URL="https://github.com/tripplemay/nextpanel.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Step 1: Pre-flight checks ──────────────────────────────────────────────

echo ""
echo "=========================================="
echo "       NextPanel One-Click Install        "
echo "=========================================="
echo ""

[ "$EUID" -eq 0 ] || fail "Please run as root: sudo bash install.sh"

if ! command -v apt-get &>/dev/null; then
  fail "This script requires a Debian/Ubuntu-based system (apt-get not found)"
fi

# Check OS compatibility
if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "$ID-$VERSION_ID" in
    ubuntu-22.04|ubuntu-24.04|debian-12) ok "Detected $PRETTY_NAME" ;;
    *) warn "Untested OS: $PRETTY_NAME. Proceeding anyway..." ;;
  esac
fi

# ── Step 2: Collect user input ──────────────────────────────────────────────

echo ""
echo "Please select access mode:"
echo "  1) Domain (recommended, auto HTTPS)"
echo "  2) IP only (HTTP)"
echo ""
read -rp "Enter [1/2]: " MODE_CHOICE

MODE="IP"
DOMAIN=""
CERTBOT_EMAIL=""

if [ "$MODE_CHOICE" = "1" ]; then
  MODE="DOMAIN"
  echo ""
  read -rp "Enter domain (A record must point to this server): " DOMAIN
  [ -n "$DOMAIN" ] || fail "Domain cannot be empty"

  read -rp "Enter email (for SSL certificate): " CERTBOT_EMAIL
  [ -n "$CERTBOT_EMAIL" ] || fail "Email is required for SSL"

  # Verify DNS
  info "Verifying DNS resolution..."
  SERVER_IP=$(hostname -I | awk '{print $1}')
  RESOLVED_IP=$(dig +short "$DOMAIN" 2>/dev/null | head -1)
  if [ "$RESOLVED_IP" = "$SERVER_IP" ]; then
    ok "DNS verified: $DOMAIN -> $SERVER_IP"
  else
    warn "DNS mismatch: $DOMAIN resolves to ${RESOLVED_IP:-nothing}, server IP is $SERVER_IP"
    read -rp "Continue anyway? [y/N]: " DNS_CONTINUE
    [ "$DNS_CONTINUE" = "y" ] || [ "$DNS_CONTINUE" = "Y" ] || fail "Aborted"
  fi
fi

echo ""
echo "Setup admin account:"
read -rp "Admin username [admin]: " ADMIN_USER
ADMIN_USER="${ADMIN_USER:-admin}"

while true; do
  read -rsp "Admin password (min 8 chars): " ADMIN_PASS
  echo ""
  if [ "${#ADMIN_PASS}" -lt 8 ]; then
    warn "Password must be at least 8 characters"
    continue
  fi
  read -rsp "Confirm password: " ADMIN_PASS_CONFIRM
  echo ""
  if [ "$ADMIN_PASS" != "$ADMIN_PASS_CONFIRM" ]; then
    warn "Passwords do not match"
    continue
  fi
  break
done

echo ""
info "Starting installation..."
echo ""

# ── Step 3: System update ──────────────────────────────────────────────────

info "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
ok "System updated"

# ── Step 4: Base utilities ─────────────────────────────────────────────────

info "Installing base utilities..."
apt-get install -y -qq curl git openssl build-essential python3 wget unzip dnsutils > /dev/null
ok "Base utilities installed"

# ── Step 5: Node.js 20 ────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null
fi
ok "Node.js $(node --version)"

# ── Step 6: pnpm + PM2 ────────────────────────────────────────────────────

if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install -g pnpm@latest > /dev/null 2>&1
fi

if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  npm install -g pm2@latest > /dev/null 2>&1
fi
ok "pnpm $(pnpm --version), PM2 $(pm2 --version | head -1)"

# ── Step 7: PostgreSQL ─────────────────────────────────────────────────────

if ! command -v psql &>/dev/null; then
  info "Installing PostgreSQL..."
  apt-get install -y -qq postgresql postgresql-contrib > /dev/null
  systemctl enable postgresql > /dev/null 2>&1
  systemctl start postgresql
fi
ok "PostgreSQL $(psql --version | awk '{print $3}')"

# ── Step 8: Database setup ─────────────────────────────────────────────────

info "Setting up database..."
DB_PASS=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 32)

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='nextpanel'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER nextpanel WITH PASSWORD '$DB_PASS';" > /dev/null

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='nextpanel'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE nextpanel OWNER nextpanel;" > /dev/null

sudo -u postgres psql -c "ALTER USER nextpanel WITH PASSWORD '$DB_PASS';" > /dev/null 2>&1
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE nextpanel TO nextpanel;" > /dev/null 2>&1
ok "Database ready"

# ── Step 9: Nginx ──────────────────────────────────────────────────────────

if ! command -v nginx &>/dev/null; then
  info "Installing Nginx..."
  apt-get install -y -qq nginx > /dev/null
  systemctl enable nginx > /dev/null 2>&1
  systemctl start nginx
fi
ok "Nginx $(nginx -v 2>&1 | awk -F/ '{print $2}')"

# ── Step 10: Certbot ──────────────────────────────────────────────────────

if ! command -v certbot &>/dev/null; then
  info "Installing Certbot..."
  apt-get install -y -qq certbot python3-certbot-nginx > /dev/null
fi
ok "Certbot installed"

# ── Step 11: Directory structure ───────────────────────────────────────────

mkdir -p "$LOG_DIR" "$BACKUP_DIR"
chmod 755 "$LOG_DIR"

# ── Step 12: Clone repository ──────────────────────────────────────────────

if [ ! -d "$APP_DIR/.git" ]; then
  info "Cloning NextPanel repository..."
  git clone --depth 1 "$REPO_URL" "$APP_DIR" > /dev/null 2>&1 || fail "Failed to clone repository"
  ok "Repository cloned"
else
  info "Repository already exists, pulling latest..."
  cd "$APP_DIR"
  git fetch origin main --depth 1 > /dev/null 2>&1
  git reset --hard origin/main > /dev/null 2>&1
  ok "Repository updated"
fi

# ── Step 13: Generate secrets & write .env ─────────────────────────────────

info "Generating secrets..."
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
GITHUB_REPO="tripplemay/nextpanel"
EOF

chmod 600 "$APP_DIR/apps/server/.env"
ok "Configuration written"

# ── Step 14: Configure Nginx ──────────────────────────────────────────────

info "Configuring Nginx..."

# Check for existing Nginx configs that might conflict
if [ "$MODE" = "DOMAIN" ]; then
  # Detect if another config already uses this domain
  CONFLICT=$(grep -rl "server_name.*$DOMAIN" /etc/nginx/sites-enabled/ 2>/dev/null | grep -v nextpanel || true)
  if [ -n "$CONFLICT" ]; then
    warn "Domain $DOMAIN is already configured in: $CONFLICT"
    warn "Disabling conflicting config to avoid routing issues..."
    for f in $CONFLICT; do
      rm -f "$f"
      ok "Disabled: $f"
    done
  fi
  sed "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" "$APP_DIR/scripts/nginx/domain.conf" \
    > /etc/nginx/sites-available/nextpanel
else
  sed "s/IP_PLACEHOLDER/$SERVER_IP/g" "$APP_DIR/scripts/nginx/ip.conf" \
    > /etc/nginx/sites-available/nextpanel
fi

ln -sf /etc/nginx/sites-available/nextpanel /etc/nginx/sites-enabled/
nginx -t > /dev/null 2>&1 || fail "Nginx config test failed"
systemctl reload nginx
ok "Nginx configured"

# ── Step 15: Swap (low memory protection) ─────────────────────────────────

TOTAL_MEM_MB=$(free -m | awk '/^Mem/ {print $2}')
if [ "$TOTAL_MEM_MB" -lt 4096 ] && [ ! -f /swapfile ]; then
  info "Low memory detected (${TOTAL_MEM_MB}MB). Creating 2GB swap..."
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap created"
fi

# ── Step 16: Install dependencies ─────────────────────────────────────────

info "Installing dependencies (this may take a few minutes)..."
cd "$APP_DIR"
pnpm install --no-frozen-lockfile > /dev/null 2>&1
cd "$APP_DIR/apps/server"
pnpm exec prisma generate > /dev/null 2>&1
ok "Dependencies installed"

# ── Step 17: Build ─────────────────────────────────────────────────────────

info "Building application (this may take a few minutes)..."
export NODE_OPTIONS="--max-old-space-size=1024"
export NEXT_TELEMETRY_DISABLED=1
cd "$APP_DIR"
pnpm -r --workspace-concurrency=1 build > /dev/null 2>&1 || fail "Build failed"
unset NODE_OPTIONS NEXT_TELEMETRY_DISABLED
ok "Build complete"

# ── Step 18: Database migration ────────────────────────────────────────────

info "Running database migrations..."
cd "$APP_DIR/apps/server"
pnpm exec prisma migrate deploy > /dev/null 2>&1
ok "Migrations applied"

# ── Step 19: Create admin user ─────────────────────────────────────────────

info "Creating admin account..."
cd "$APP_DIR/apps/server"
pnpm exec ts-node -r tsconfig-paths/register prisma/seed.ts "$ADMIN_USER" "$ADMIN_PASS" > /dev/null 2>&1
ok "Admin account created"

# ── Step 20: Start services with PM2 ──────────────────────────────────────

info "Starting services..."
cd "$APP_DIR"
pm2 delete all > /dev/null 2>&1 || true
pm2 start ecosystem.config.cjs > /dev/null 2>&1

# Register PM2 startup
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -n 1 | bash > /dev/null 2>&1 || true
pm2 save > /dev/null 2>&1
ok "Services started"

# ── Step 21: SSL certificate (domain mode) ─────────────────────────────────

if [ "$MODE" = "DOMAIN" ]; then
  info "Requesting SSL certificate..."
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" > /dev/null 2>&1; then
    systemctl enable certbot.timer > /dev/null 2>&1 || true
    ok "SSL certificate installed (auto-renewal enabled)"
  else
    warn "SSL setup failed. Panel accessible via HTTP. Run 'nextpanel domain set $DOMAIN' to retry."
  fi
fi

# ── Step 22: Install Xray & Sing-box (optional) ───────────────────────────

ARCH=$(uname -m | sed 's/x86_64/64/;s/aarch64/arm64-v8a/')
if ! command -v xray &>/dev/null; then
  info "Installing Xray test client..."
  if curl -fsSL "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${ARCH}.zip" -o /tmp/xray.zip 2>/dev/null; then
    unzip -oq /tmp/xray.zip xray -d /usr/local/bin/ 2>/dev/null && chmod +x /usr/local/bin/xray
    rm -f /tmp/xray.zip
    ok "Xray installed"
  else
    warn "Xray installation failed (optional, skipped)"
  fi
fi

SB_ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
if ! command -v sing-box &>/dev/null; then
  info "Installing sing-box test client..."
  SB_TAG=$(curl -sf "https://api.github.com/repos/SagerNet/sing-box/releases/latest" 2>/dev/null | grep '"tag_name"' | head -1 | sed 's/.*"\(v[^"]*\)".*/\1/')
  if [ -n "$SB_TAG" ]; then
    if curl -fsSL "https://github.com/SagerNet/sing-box/releases/download/${SB_TAG}/sing-box-${SB_TAG#v}-linux-${SB_ARCH}.tar.gz" -o /tmp/sb.tar.gz 2>/dev/null; then
      tar xzf /tmp/sb.tar.gz -C /tmp/ 2>/dev/null
      mv /tmp/sing-box-*/sing-box /usr/local/bin/sing-box 2>/dev/null && chmod +x /usr/local/bin/sing-box
      rm -rf /tmp/sb.tar.gz /tmp/sing-box-*/
      ok "sing-box installed"
    else
      warn "sing-box installation failed (optional, skipped)"
    fi
  fi
fi

# ── Step 23: Install CLI tool ──────────────────────────────────────────────

info "Installing nextpanel CLI..."
cp "$APP_DIR/scripts/nextpanel" /usr/local/bin/nextpanel
chmod +x /usr/local/bin/nextpanel
ok "CLI installed: nextpanel"

# ── Step 24: Wait and verify ───────────────────────────────────────────────

info "Waiting for services to start..."
sleep 8

# ── Done ───────────────────────────────────────────────────────────────────

echo ""
echo "=========================================="
echo -e "  ${GREEN}NextPanel Installation Complete!${NC}"
echo "=========================================="
echo ""
if [ "$MODE" = "DOMAIN" ]; then
  echo -e "  Panel URL:  ${CYAN}https://$DOMAIN${NC}"
else
  echo -e "  Panel URL:  ${CYAN}http://$SERVER_IP${NC}"
fi
echo ""
echo "  Admin Username:  $ADMIN_USER"
echo "  Admin Password:  [as provided]"
echo ""
echo "  Management Commands:"
echo "    nextpanel status     - View service status"
echo "    nextpanel update     - Update to latest version"
echo "    nextpanel backup     - Backup database"
echo "    nextpanel logs       - View logs"
echo "    nextpanel domain set - Bind domain with SSL"
echo ""
echo "  Service Status:"
pm2 list
echo ""
