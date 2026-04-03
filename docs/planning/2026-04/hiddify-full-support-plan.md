# Hiddify 完整支持实施计划

> 日期：2026-04-03
> 状态：待确认

## 背景

NextPanel 计划将 Hiddify 作为推荐客户端，需要从"基本兼容"升级为"一等公民"支持。Hiddify 是基于 sing-box 引擎的全平台代理客户端（iOS/Android/Windows/macOS/Linux），开源免费。

## 当前兼容状态

| 功能 | 状态 | 说明 |
|------|:----:|------|
| V2Ray Base64 订阅导入 | 可用 | 节点列表正常 |
| Clash YAML 订阅导入 | 可用 | Hiddify 内部转为 sing-box |
| sing-box JSON 订阅导入 | 可用但不完整 | 缺少 DNS/路由规则，只有全局代理模式 |
| 单节点 URI 导入 | 可用 | vmess:// vless:// 等 |
| Hiddify Deep Link | 不支持 | 手机用户需手动复制粘贴 |
| 用户引导 | 无 | 无任何 Hiddify 相关说明 |

## 改动清单

### Phase 1：后端 — sing-box 订阅质量提升（CRITICAL）

**目标**：让 Hiddify 用户导入后自动获得"绕过中国大陆"分流能力，而非只有全局代理。

**文件**：`apps/server/src/subscriptions/uri-builder.ts` — `buildSingboxOutbound` 和相关函数

**当前输出**：
```json
{
  "log": { "level": "info" },
  "outbounds": [
    { "type": "vless", ... },
    { "type": "selector", "tag": "🚀 节点选择", ... },
    { "type": "direct", "tag": "direct" },
    { "type": "block", "tag": "block" }
  ],
  "route": {
    "final": "🚀 节点选择"
  }
}
```

**目标输出**：
```json
{
  "log": { "level": "info", "timestamp": true },
  "dns": {
    "servers": [
      { "tag": "proxy-dns", "address": "https://8.8.8.8/dns-query", "detour": "🚀 节点选择" },
      { "tag": "direct-dns", "address": "https://223.5.5.5/dns-query", "detour": "direct" },
      { "tag": "block-dns", "address": "rcode://success" }
    ],
    "rules": [
      { "rule_set": ["geosite-category-ads-all"], "server": "block-dns" },
      { "rule_set": ["geosite-cn"], "server": "direct-dns" }
    ],
    "strategy": "prefer_ipv4"
  },
  "outbounds": [
    { "type": "vless", ... },
    {
      "type": "selector",
      "tag": "🚀 节点选择",
      "outbounds": ["⚡ 自动选择", ...node_tags],
      "default": "⚡ 自动选择"
    },
    {
      "type": "urltest",
      "tag": "⚡ 自动选择",
      "outbounds": [...node_tags],
      "url": "http://www.gstatic.com/generate_204",
      "interval": "5m"
    },
    { "type": "direct", "tag": "direct" },
    { "type": "block", "tag": "block" },
    { "type": "dns", "tag": "dns-out" }
  ],
  "route": {
    "rule_set": [
      { "tag": "geosite-cn", "type": "remote", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs" },
      { "tag": "geoip-cn", "type": "remote", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs" },
      { "tag": "geosite-category-ads-all", "type": "remote", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs" }
    ],
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" },
      { "rule_set": ["geosite-category-ads-all"], "outbound": "block" },
      { "rule_set": ["geosite-cn"], "outbound": "direct" },
      { "rule_set": ["geoip-cn"], "outbound": "direct" },
      { "ip_is_private": true, "outbound": "direct" }
    ],
    "final": "🚀 节点选择",
    "auto_detect_interface": true
  }
}
```

**核心改动**：
1. 新增 `dns` 配置段 — 国内域名用国内 DNS，国外域名用代理 DNS，广告域名拦截
2. 新增 `route.rules` — 中国域名/IP 直连、广告拦截、私有 IP 直连
3. 新增 `route.rule_set` — 远程 GeoIP/GeoSite 规则集（使用 SagerNet 官方源）
4. 新增 `urltest` outbound — 自动选择最低延迟节点
5. 新增 `dns` outbound — DNS 流量特殊处理

---

### Phase 2：后端 — Hiddify Deep Link（CRITICAL）

**目标**：生成 Hiddify 专用的一键导入链接。

**Deep Link 格式**：
```
hiddify://import/<base64编码的订阅URL>
```

**示例**：
```
订阅 URL: https://vpn.vpanel.cc/api/subscriptions/link/abc123/singbox
Deep Link: hiddify://import/aHR0cHM6Ly92cG4udnBhbmVsLmNjL2FwaS9zdWJzY3JpcHRpb25zL2xpbmsvYWJjMTIzL3Npbmdib3g=
```

**文件**：`apps/server/src/subscriptions/uri-builder.ts` 或 `subscriptions.service.ts`

**新增函数**：
```typescript
export function buildHiddifyDeepLink(subscriptionUrl: string): string {
  const encoded = Buffer.from(subscriptionUrl).toString('base64');
  return `hiddify://import/${encoded}`;
}
```

---

### Phase 3：前端 — 订阅导出弹窗（HIGH）

**目标**：新增 Hiddify 标签页，提供 deep link + 说明 + 一键导入按钮。

**文件**：`apps/web/src/app/(dashboard)/subscriptions/page.tsx`

**改动**：

1. `getFormats()` 新增 Hiddify 格式：
```typescript
function getFormats(token: string): SubFormat[] {
  const base = `${window.location.origin}/api/subscriptions/link/${token}`;
  const singboxUrl = `${base}/singbox`;
  return [
    { key: 'v2ray', label: 'V2Ray / Xray Base64', url: base },
    { key: 'clash', label: 'Clash / Mihomo YAML', url: `${base}/clash` },
    { key: 'singbox', label: 'Sing-box JSON', url: singboxUrl },
    { key: 'hiddify', label: 'Hiddify', url: `hiddify://import/${btoa(singboxUrl)}` },
  ];
}
```

2. Hiddify 标签页内容：
- Deep link（点击直接打开 Hiddify App）
- sing-box 订阅 URL（备用，手动复制）
- QR 码（扫码导入）
- 说明文字："推荐使用 Hiddify 客户端（全平台免费开源）"
- Hiddify 下载链接

3. 每个格式标签页加推荐说明：
- V2Ray：通用格式，兼容所有客户端
- Clash：适合需要精细分流的用户（Clash Verge、Stash）
- Sing-box：适合 Hiddify、sing-box 原生客户端
- Hiddify：**推荐** — 一键导入，全平台支持

---

### Phase 4：前端 — 节点分享增强（HIGH）

**目标**：NodeShareModal 支持 Hiddify deep link。

**文件**：`apps/web/src/components/nodes/NodeShareModal.tsx`

**改动**：
1. 将单个节点 URI 也生成 Hiddify deep link：
```typescript
const hiddifyLink = `hiddify://import/${btoa(uri)}`;
```
2. 弹窗中新增 Hiddify 标签页，显示 deep link + QR 码

---

### Phase 5：界面文案更新（MEDIUM）

**文件**：`apps/web/src/components/auth/AuthLayout.tsx`

**改动**：
```typescript
// 当前
{ title: '订阅管理', desc: '生成 Clash / Sing-Box 订阅' }

// 改为
{ title: '订阅管理', desc: '支持 Hiddify / Clash / Sing-Box 客户端' }
```

---

### Phase 6：用户文档（MEDIUM）

**新增文件**：`docs/guides/hiddify-setup.md`

**内容**：
1. Hiddify 简介 + 下载链接
2. 导入订阅的三种方式（deep link / QR 码 / 手动 URL）
3. 推荐使用 sing-box 格式
4. 常见问题（分流模式选择、节点更新等）

---

## 不需要改动的部分

| 部分 | 原因 |
|------|------|
| 协议支持 | 5 个预设已完全兼容 Hiddify |
| V2Ray Base64 格式 | 已兼容 |
| Clash YAML 格式 | 已兼容（上一轮修复了 Trojan tls、VMESS REALITY flow） |
| 节点 URI 生成 | 已兼容所有格式 |
| 服务端引擎 | 保持 Xray，无需切换到 sing-box |

## 风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| sing-box 规则集 URL 变更 | LOW | SagerNet 官方源稳定，但需关注仓库迁移 |
| Hiddify deep link 格式变更 | LOW | 格式已稳定 |
| DNS 配置影响已有用户 | LOW | 仅影响 sing-box 格式输出，V2Ray/Clash 不变 |

## 实施顺序

1. **Phase 1** — sing-box JSON 质量提升（最关键，决定用户体验）
2. **Phase 2** — Deep Link 生成（配合 Phase 3 一起上）
3. **Phase 3** — 订阅导出弹窗 UX
4. **Phase 4** — 节点分享增强
5. **Phase 5** — 文案更新
6. **Phase 6** — 用户文档
