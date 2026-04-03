# Hiddify 客户端与 sing-box 引擎分析报告

> 日期：2026-04-03

## 一、Hiddify 客户端概览

### 定位
开源免费的多平台代理客户端，底层基于 sing-box 引擎，面向普通用户设计。

### 平台支持
- Android（Google Play 上架）
- iOS（App Store 上架）
- Windows / macOS / Linux

全平台覆盖是 Hiddify 最大的竞争优势，目前能同时覆盖 iOS + Android + 三大桌面平台的开源客户端极少。

### 协议支持
支持 30+ 协议：VLESS、VMess、Trojan、Shadowsocks、Hysteria2、TUIC、Reality、gRPC、WebSocket、QUIC、ShadowTLS、SSH、ECH 等。

与 NextPanel 的 5 个协议预设（VLESS+REALITY、VLESS+WS+TLS、VLESS+TCP+TLS、Hysteria2、VMess+TCP）完全兼容。

---

## 二、核心优势

### 用户友好
- 无需理解 JSON/YAML 配置，一键导入订阅链接
- 自动最低延迟选择（LowestPing）
- 支持 deep link 一键导入、扫码导入

### 开源 + 免费 + 无广告
- GitHub 开源，社区活跃
- 完全免费，无订阅费，无广告，无追踪

### 导入方式
- V2Ray Base64 订阅链接
- Clash YAML 订阅链接
- sing-box JSON 订阅链接（原生格式，兼容性最佳）
- 单个 URI（vmess://、vless:// 等）
- 剪贴板导入、扫码导入

---

## 三、安全性分析

| 维度 | 评价 |
|------|------|
| 开源可审计 | 代码完全公开，任何人可审查 |
| 安全审计 | 项目声称经过安全审计，但未公开第三方审计报告 |
| 数据收集 | 不收集用户数据，不需要注册账号 |
| 引擎安全 | sing-box 和 Xray 均为成熟开源引擎，支持 REALITY、TLS 1.3、uTLS 指纹伪装 |
| iOS 安全 | App Store 上架需经过 Apple 审查，有一定安全背书 |
| 风险点 | Flutter 跨平台框架依赖链较长，供应链攻击面比原生应用大 |

**结论**：安全性良好，但缺乏独立第三方审计报告。

---

## 四、速度与性能

| 维度 | 表现 |
|------|------|
| 引擎性能 | sing-box 内存占用约 70MB（客户端），低于 v2ray-core 的 240MB+ |
| 电池消耗 | 低于 v2rayNG 等客户端 |
| 智能路由 | 自动最低延迟选择，TUN 模式系统级代理 |
| 用户反馈 | 延迟低、速度稳定、体验流畅 |

---

## 五、分流规则

### 内置模式
| 模式 | 行为 |
|------|------|
| 全局代理 | 所有流量走代理 |
| 绕过局域网和中国大陆 | 国内直连，国外走代理（最常用）|
| 绕过局域网 | 仅局域网直连 |

### 局限性
- **不支持**按域名/IP 自定义分流规则
- **不支持**导入第三方规则集（rule-provider）
- **不支持**多出口策略（如 Netflix 走 A 节点、YouTube 走 B 节点）
- 这是 Hiddify 有意为之，保持软件简洁

### 与 Clash 系客户端对比
| 能力 | Hiddify | Clash Verge/Mihomo |
|------|:-------:|:-----------------:|
| 按域名/IP 分流 | 仅内置规则 | 支持自定义 |
| 第三方规则集 | 不支持 | 支持 |
| 多出口策略 | 不支持 | 支持 |
| 按应用分流 | 支持 | 支持 |

**建议**：需要精细分流的用户用 Clash Verge，只需基本代理的用户用 Hiddify。

---

## 六、与竞品对比

| 维度 | Hiddify | Clash Verge | v2rayN | Shadowrocket |
|------|---------|-------------|--------|-------------|
| 平台 | 全平台（含 iOS） | Win/Mac/Linux | 仅 Windows | 仅 iOS |
| 上手难度 | 低 | 中 | 中 | 低 |
| 协议数 | 30+（最全） | 依赖 Mihomo | 依赖 Xray | 较多 |
| 分流能力 | 基础 | 强 | 基础 | 强 |
| 开源 | 是 | 是 | 是 | 否 |
| 价格 | 免费 | 免费 | 免费 | 付费 |

---

## 七、Hiddify 与 NextPanel 兼容性

### 订阅格式兼容
| 格式 | 兼容性 | 说明 |
|------|:------:|------|
| V2Ray Base64 | 完全兼容 | |
| Clash YAML | 完全兼容 | Hiddify 内部转为 sing-box 执行 |
| sing-box JSON | 完全兼容 | 原生格式，推荐使用 |

### 协议兼容
NextPanel 的 5 个预设在 Hiddify 全部可用。

### 推荐导入格式
sing-box JSON — Hiddify 底层就是 sing-box，直接使用无需转换，兼容性最好。

---

## 八、sing-box 作为服务端引擎的分析

### 现状
NextPanel 当前使用 Xray 作为主要服务端引擎，仅 Hysteria2 使用 sing-box。

### 服务端性能对比

| 维度 | Xray | sing-box |
|------|------|---------|
| 吞吐量 | 基准 | 持平（iperf3 测试几乎无差异）|
| 内存占用 | 30-50MB | 15-30MB（更低） |
| CPU 占用 | 持平 | 持平 |
| VLESS+REALITY | 原创实现，参考标准 | 兼容实现 |
| Hysteria2 | 不支持 | 支持 |
| TUIC | 不支持 | 支持 |

### 为什么速度几乎一样
代理服务器的性能瓶颈不在引擎本身，而在：
- 网络带宽（硬上限）
- TLS 加解密（两者都用 Go 标准库）
- TCP/UDP 转发（内核层面操作）
- 协议头解析（VLESS 头极小，开销可忽略）

### 是否值得切换
**当前不建议切换**。理由：
1. 速度无提升 — 吞吐量持平，切换引擎不会带来可感知的加速
2. REALITY 是 Xray 原创 — Xray 实现是参考标准，sing-box 是兼容实现
3. 改动量大 — 需重写配置生成器、部署逻辑、流量统计接口
4. 系统已稳定 — 引入回归风险

**未来可考虑的时机**：
- sing-box 的 REALITY 实现完全成熟且社区验证充分
- 需要新增 TUIC 等 Xray 不支持的协议
- 小内存 VPS 用户量大，需要降低服务端内存开销

---

## 九、结论与建议

### 对用户的推荐策略
| 用户类型 | 推荐客户端 | 推荐订阅格式 |
|----------|-----------|------------|
| 普通用户 / 多设备 | Hiddify | sing-box JSON |
| 需要精细分流 | Clash Verge（PC）/ Stash（iOS） | Clash YAML |
| 仅 Windows | v2rayN 或 Clash Verge | V2Ray Base64 或 Clash YAML |

### 对 NextPanel 的建议
1. 保持 Xray 为主要服务端引擎，不切换
2. 推荐 Hiddify 作为首选客户端（全平台、免费、兼容性好）
3. 推荐用户使用 sing-box JSON 格式订阅（Hiddify 原生格式）
4. Clash YAML 作为需要分流功能的用户备选
