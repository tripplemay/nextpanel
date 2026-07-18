# IP 路由检测功能 技术设计文档

## 背景

在现有 IP 质量检测（流媒体解锁、GFW封锁检测）基础上，新增去程/回程路由测试，帮助用户了解节点与国内各运营商的连接质量和路由路径。

## 需求确认

### 测试方向
- **去程**：中国 → 节点（国内用户连接代理的路径）
- **回程**：节点 → 中国（代理返回数据的路径）

### 测试指标
- ICMP ping 延迟（ms）+ 丢包率
- TCP 握手延迟（更接近实际使用）
- Traceroute 路径（途经节点、ASN、进入中国骨干网位置）

### 覆盖范围（标准版）
3 运营商 × 3 城市 = 9 个测速节点

| 运营商 | 北京 | 上海 | 广州 |
|--------|------|------|------|
| 联通 | 202.106.0.20 | 210.22.97.1 | 221.5.88.88 |
| 电信 | 202.96.128.166 | 202.96.209.133 | 202.96.134.133 |
| 移动 | 221.130.33.52 | 120.196.165.24 | 211.136.192.6 |

---

## 技术架构

### 去程（中国 → 节点）
- **执行方**：面板服务端
- **方式**：调用国内第三方测速平台 API（itdog.cn、ping.chinaz.com 等）
- **获取数据**：国内各节点对该 IP 的 ping 延迟 + 丢包率
- **限制**：去程 traceroute 路径无法通过此方式获取（第三方不支持）
- **鲁棒性**：健康感知 Provider 自动切换（详见下节）

### 回程（节点 → 中国）
- **执行方**：Agent 在节点服务器上执行
- **方式**：本地执行 nexttrace（优先）/ 标准 traceroute（fallback）
- **获取数据**：ping 延迟 + TCP 延迟 + 完整 traceroute hops（含 ASN）
- **触发时机**：与现有流媒体检测同步触发（heartbeat 任务）

### Provider 健康感知机制

去程依赖多个第三方 API，通过健康感知自动切换：

```
Provider 优先级列表（内存维护）:
  1. itdog.cn       failCount=0  状态=健康
  2. ping.chinaz.com failCount=0  状态=健康
  3. ipip.net        failCount=0  状态=健康

调用逻辑:
  - 选第一个「健康」Provider 发起请求
  - 成功 → 重置 failCount，记录 lastSuccess
  - 失败 → failCount++，超过阈值（3次）进入冷却（5分钟）
  - 冷却期内跳过该 Provider，尝试下一个
  - 冷却结束后自动恢复（下次调用时重试）
  - 全部不可用 → 去程数据留空，前端显示提示
```

---

## 数据库变更

### ServerIpCheck 表新增字段

```sql
ALTER TABLE "ServerIpCheck" ADD COLUMN "routeData" JSONB;
```

### routeData JSON 结构

```json
{
  "checkedAt": "2026-03-09T10:00:00Z",
  "outbound": [
    {
      "isp": "联通",
      "city": "北京",
      "ip": "202.106.0.20",
      "pingMs": 28.3,
      "tcpMs": 31.0,
      "loss": 0,
      "hops": [
        { "n": 1, "ip": "10.0.0.1", "asn": "AS12345", "org": "Hetzner", "ms": 0.8 },
        { "n": 2, "ip": "202.97.0.1", "asn": "AS4134", "org": "ChinaTelecom", "ms": 28.4 }
      ]
    }
  ],
  "inbound": [
    {
      "isp": "联通",
      "city": "北京",
      "pingMs": 32.5,
      "loss": 0,
      "source": "itdog"
    }
  ]
}
```

---

## 实现计划

### Phase 1：数据库 Schema
- `prisma/schema.prisma`：`ServerIpCheck` 新增 `routeData Json?`
- 创建 Prisma 迁移文件

### Phase 2：Agent 侧回程检测（新增 `route_check.go`）
- 定义 9 个目标 IP 常量
- `runRouteCheck()` 函数：
  - 检测 nexttrace 可用性，fallback 到系统 traceroute
  - 并发对 9 个 IP 执行：ping（3包）、TCP 握手测试、traceroute
  - 解析 hops：IP、ASN、org、RTT
  - 总超时：90 秒
- `ipCheckResult` 新增 `routeData` 字段
- `runIpCheck()` 调用 `runRouteCheck()` 并合并结果

### Phase 3：面板侧去程检测（新增 `RouteCheckService`）
- 定义 `RouteProvider` 接口 + itdog / chinaz / ipip 三个适配器
- `ProviderHealthManager`：维护 Provider 健康状态（内存，进程级）
- `checkInbound(ip: string)`：选健康 Provider 发请求，处理失败切换
- `IpCheckService.runCheck()` 中并发调用去程检测（与 GFW 检测并行）

### Phase 4：DTO + Service 扩展
- `ReportIpCheckResultDto` 新增 `routeData?: object`
- `IpCheckService.reportResult()` 写入 `routeData`
- `getLatest()` 返回值透传 `routeData`（已有接口，无需改路由）

### Phase 5：前端展示
- 服务器详情 IP 检测卡片新增「路由测试」Tab
- **去程表格**：3行（运营商）× 3列（城市），单元格显示 ping ms + 丢包
- **回程列表**：每行显示 ISP + 城市 + 延迟，可展开查看 traceroute hops
  - hops 展示：跳数、IP、ASN/org、延迟，中国骨干节点高亮
- 数据来源标注（「去程数据来源: itdog.cn」）
- 去程不可用时显示「去程检测暂不可用，回程数据正常」

---

## 版本兼容

| Agent 版本 | 回程测试 |
|---|---|
| v1.3.0 | 不支持（无 route_check.go） |
| v1.4.0+ | 支持 |

前端检测到 `routeData.outbound` 为空时，显示「需要 Agent v1.4.0+ 以获取回程数据」。

---

## 风险与注意事项

1. **去程 API 无公开协议**：itdog 等平台的接口属于"借用"，随时可能失效或限流，健康感知机制是必要的保底手段
2. **nexttrace 安装**：节点服务器不一定有 nexttrace，fallback 到系统 traceroute 时缺少 ASN 信息，hops 中 org 字段留空
3. **检测时间**：回程 9 个节点并发执行，预计 60–90 秒；去程调 API 约 10–20 秒；总体与现有流媒体检测时间相当
4. **ICMP 被屏蔽**：部分节点服务器出站 ICMP 受限，TCP 握手测试作为备用
5. **routeData 只写不迁移**：存量记录 `routeData` 为 null，触发新检测后写入

---

## 沟通记录

- 2026-03-09：用户确认去程+回程、9节点标准版、指标（ping/TCP/traceroute）、Provider健康感知自动切换方案
