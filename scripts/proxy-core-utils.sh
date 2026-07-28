#!/usr/bin/env bash

# Version-aware installers for the proxy cores used by the panel's local
# connectivity tests. Callers provide info(), ok(), and warn() log helpers.

XRAY_TEST_MIN_VERSION="25.3.6"
SINGBOX_TEST_MIN_VERSION="1.12.0"

proxy_core_version_ge() {
  local current="$1"
  local minimum="$2"
  [ "$(printf '%s\n%s\n' "$minimum" "$current" | sort -V | head -n 1)" = "$minimum" ]
}

xray_stable_version() {
  local output
  output="$("$1" version 2>/dev/null)" || return 1
  printf '%s\n' "$output" | awk '
    /^Xray[[:space:]]+v?[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|$)/ {
      version = $2
      sub(/^v/, "", version)
      if (version ~ /^[0-9]+\.[0-9]+\.[0-9]+$/) print version
      exit
    }
  '
}

singbox_stable_version() {
  local output
  output="$("$1" version 2>/dev/null)" || return 1
  printf '%s\n' "$output" | awk '
    /^sing-box version[[:space:]]+v?[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|$)/ {
      version = $3
      sub(/^v/, "", version)
      if (version ~ /^[0-9]+\.[0-9]+\.[0-9]+$/) print version
      exit
    }
  '
}

proxy_core_arches() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s %s\n' '64' 'amd64' ;;
    aarch64|arm64) printf '%s %s\n' 'arm64-v8a' 'arm64' ;;
    *) return 1 ;;
  esac
}

github_release_tag() {
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const tag = JSON.parse(input).tag_name;
        if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) process.exit(1);
        process.stdout.write(tag);
      } catch { process.exit(1); }
    });
  '
}

github_release_asset_sha256() {
  local asset_name="$1"
  GITHUB_ASSET_NAME="$asset_name" node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const release = JSON.parse(input);
        const asset = release.assets?.find(
          (item) => item.name === process.env.GITHUB_ASSET_NAME && item.state === "uploaded",
        );
        const match = asset?.digest?.match(/^sha256:([0-9a-f]{64})$/i);
        if (!match) process.exit(1);
        process.stdout.write(match[1].toLowerCase());
      } catch { process.exit(1); }
    });
  '
}

ensure_xray_test_core() {
  local binary
  local current=""
  binary="$(command -v xray 2>/dev/null || true)"
  if [ -n "$binary" ]; then
    current="$(xray_stable_version "$binary" || true)"
  fi
  if [ -n "$current" ] && proxy_core_version_ge "$current" "$XRAY_TEST_MIN_VERSION"; then
    ok "Xray ${current}（节点测试最低要求 ${XRAY_TEST_MIN_VERSION}）"
    return 0
  fi

  if [ -n "$current" ]; then
    info "Xray ${current} 低于 ${XRAY_TEST_MIN_VERSION}，正在升级..."
  else
    info "正在安装 Xray 测试客户端（最低 ${XRAY_TEST_MIN_VERSION}）..."
  fi

  local arches xray_arch temp_dir staged_binary installed
  arches="$(proxy_core_arches)" || {
    warn "当前 CPU 架构不支持自动安装 Xray：$(uname -m)"
    return 1
  }
  xray_arch="${arches%% *}"
  temp_dir="$(mktemp -d)" || return 1
  staged_binary="$(mktemp /usr/local/bin/.xray.nextpanel.XXXXXX)" || {
    rm -rf -- "$temp_dir"
    return 1
  }

  installed=0
  if (
    set -eu
    trap 'rm -rf -- "$temp_dir"; rm -f -- "$staged_binary"' EXIT HUP INT TERM
    archive="$temp_dir/Xray-linux-${xray_arch}.zip"
    digest_file="$archive.dgst"
    download_url="https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${xray_arch}.zip"

    curl -fsSL --retry 3 "$download_url" -o "$archive" 2>/dev/null
    curl -fsSL --retry 3 "$download_url.dgst" -o "$digest_file" 2>/dev/null
    expected="$(sed -n 's/^SHA2-256= \([[:xdigit:]]\{64\}\)$/\1/p' "$digest_file" | head -n 1)"
    if ! [[ "$expected" =~ ^[0-9A-Fa-f]{64}$ ]]; then
      warn "Xray 官方 SHA-256 摘要缺失或格式无效"
      exit 1
    fi
    if ! printf '%s  %s\n' "$expected" "$archive" | sha256sum -c - >/dev/null 2>&1; then
      warn "Xray 发布包 SHA-256 校验失败，拒绝替换现有核心"
      exit 1
    fi

    unzip -oq "$archive" xray -d "$temp_dir" 2>/dev/null
    install -m 0755 "$temp_dir/xray" "$staged_binary"
    candidate_version="$(xray_stable_version "$staged_binary" || true)"
    if [ -z "$candidate_version" ] || \
      ! proxy_core_version_ge "$candidate_version" "$XRAY_TEST_MIN_VERSION"; then
      warn "Xray 临时二进制版本校验失败（当前 ${candidate_version:-unknown}）"
      exit 1
    fi
    mv -f -- "$staged_binary" /usr/local/bin/xray
  ); then
    installed=1
  fi

  if [ "$installed" -ne 1 ]; then
    warn "Xray 安装失败（VLESS XHTTP/REALITY 连通性测试将不可用）"
    return 1
  fi

  current="$(xray_stable_version /usr/local/bin/xray || true)"
  if [ -z "$current" ] || ! proxy_core_version_ge "$current" "$XRAY_TEST_MIN_VERSION"; then
    warn "Xray 安装后版本校验失败（当前 ${current:-unknown}，要求 $XRAY_TEST_MIN_VERSION+）"
    return 1
  fi
  ok "Xray 已安装并验证：$current"
}

ensure_singbox_test_core() {
  local binary
  local current=""
  binary="$(command -v sing-box 2>/dev/null || true)"
  if [ -n "$binary" ]; then
    current="$(singbox_stable_version "$binary" || true)"
  fi
  if [ -n "$current" ] && proxy_core_version_ge "$current" "$SINGBOX_TEST_MIN_VERSION"; then
    ok "sing-box ${current}（节点测试最低要求 ${SINGBOX_TEST_MIN_VERSION}）"
    return 0
  fi

  if [ -n "$current" ]; then
    info "sing-box ${current} 低于 ${SINGBOX_TEST_MIN_VERSION}，正在升级..."
  else
    info "正在安装 sing-box 测试客户端（最低 ${SINGBOX_TEST_MIN_VERSION}）..."
  fi

  local arches singbox_arch release_json tag archive_name asset_digest temp_dir staged_binary installed
  arches="$(proxy_core_arches)" || {
    warn "当前 CPU 架构不支持自动安装 sing-box：$(uname -m)"
    return 1
  }
  singbox_arch="${arches##* }"
  release_json="$(curl -sf 'https://api.github.com/repos/SagerNet/sing-box/releases/latest' 2>/dev/null || true)"
  tag="$(printf '%s' "$release_json" | github_release_tag 2>/dev/null || true)"
  if [ -z "$tag" ]; then
    warn "无法获取稳定版 sing-box 版本"
    return 1
  fi

  archive_name="sing-box-${tag#v}-linux-${singbox_arch}.tar.gz"
  asset_digest="$(printf '%s' "$release_json" | \
    github_release_asset_sha256 "$archive_name" 2>/dev/null || true)"
  if ! [[ "$asset_digest" =~ ^[0-9a-f]{64}$ ]]; then
    warn "sing-box 官方发布资产缺少有效的 GitHub SHA-256 digest"
    return 1
  fi

  temp_dir="$(mktemp -d)" || return 1
  staged_binary="$(mktemp /usr/local/bin/.sing-box.nextpanel.XXXXXX)" || {
    rm -rf -- "$temp_dir"
    return 1
  }
  installed=0
  if (
    set -eu
    trap 'rm -rf -- "$temp_dir"; rm -f -- "$staged_binary"' EXIT HUP INT TERM
    archive="$temp_dir/$archive_name"
    binary_path="$temp_dir/sing-box-${tag#v}-linux-${singbox_arch}/sing-box"
    download_url="https://github.com/SagerNet/sing-box/releases/download/${tag}/${archive_name}"

    curl -fsSL --retry 3 "$download_url" -o "$archive" 2>/dev/null
    if ! printf '%s  %s\n' "$asset_digest" "$archive" | \
      sha256sum -c - >/dev/null 2>&1; then
      warn "sing-box 发布包 SHA-256 校验失败，拒绝替换现有核心"
      exit 1
    fi

    tar xzf "$archive" -C "$temp_dir" 2>/dev/null
    install -m 0755 "$binary_path" "$staged_binary"
    candidate_version="$(singbox_stable_version "$staged_binary" || true)"
    if [ "$candidate_version" != "${tag#v}" ] || \
      ! proxy_core_version_ge "$candidate_version" "$SINGBOX_TEST_MIN_VERSION"; then
      warn "sing-box 临时二进制版本校验失败（当前 ${candidate_version:-unknown}）"
      exit 1
    fi
    mv -f -- "$staged_binary" /usr/local/bin/sing-box
  ); then
    installed=1
  fi

  if [ "$installed" -ne 1 ]; then
    warn "sing-box 安装失败（Hysteria2、TUIC、AnyTLS 连通性测试将不可用）"
    return 1
  fi

  current="$(singbox_stable_version /usr/local/bin/sing-box || true)"
  if [ -z "$current" ] || ! proxy_core_version_ge "$current" "$SINGBOX_TEST_MIN_VERSION"; then
    warn "sing-box 安装后版本校验失败（当前 ${current:-unknown}，要求 $SINGBOX_TEST_MIN_VERSION+）"
    return 1
  fi
  ok "sing-box 已安装并验证：$current"
}

ensure_proxy_test_cores() {
  local failed=0
  ensure_xray_test_core || failed=1
  ensure_singbox_test_core || failed=1
  return "$failed"
}
