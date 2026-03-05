/**
 * REALITY 协议常量
 *
 * REALITY 要求服务端和客户端必须同时配置 xtls-rprx-vision 流控，
 * 以及匹配的 SNI（serverName）。这里统一定义，避免多处硬编码导致不一致。
 *
 * 受影响的三条代码路径，修改时需同时检查：
 *   [ ] 服务端部署配置  — nodes/config/xray-config.ts
 *   [ ] 订阅导出        — subscriptions/uri-builder.ts（vless:// / Clash / Sing-box）
 *   [ ] 测试客户端      — nodes/xray-test/config-builder.ts
 */

/** VLESS+REALITY 必须在服务端和客户端同时使用的流控类型 */
export const REALITY_FLOW = 'xtls-rprx-vision';

/**
 * 未配置自定义 domain 时的默认 REALITY SNI。
 * 必须与 xray-config.ts 中 serverNames 保持一致。
 *
 * 注意：www.google.com 在中国被 GFW 屏蔽，且 GFW 会对"SNI=google.com 但目标 IP
 * 不是 Google IP"的连接注入 RST，导致 REALITY 从中国无法连通。
 * 改用在中国可访问、且与代理服务器所在 CDN 吻合的域名。
 */
export const REALITY_DEFAULT_SNI = 'addons.mozilla.org';
