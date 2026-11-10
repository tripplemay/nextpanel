# 服务器硬件信息：本地实现与验证

日期：2026-11-11。状态：本地实现完成；未部署、未发布 Agent、未执行生产迁移。

## 已实现

- 独立 Agent 采集和 `/api/agent/system-info` 上报，版本 1.9.0；不增加原心跳字段。
- 增量迁移和一对一配置快照；字段级成功时间、缺失字段、过期和乱序保护。
- 详情页硬件与系统卡片，保留原有布局，根文件系统容量与根分区使用率口径一致。
- 沿用 Token 绑定和 userId 读取隔离，不依赖 SSH，不自动升级或执行探测命令。
- 旧版本、无数据、部分失败、离线、过期、未知格式、容器口径和长文本降级。

## 验证结果

| 检查 | 结果 | 证据范围 |
|---|---|---|
| 后端 Jest | 64/64 suites，1431/1431 tests | 本地单元 / HTTP fixture；非生产 |
| Prisma validate / generate | 通过 | schema 和生成客户端 |
| PostgreSQL 集成 | 通过 | 临时 Unix socket 数据库、全迁移、真实 HTTP、权限、部分失败时间保留、并发乱序、级联删除、恢复演练、编译后应用启动 |
| Agent | `go test -race`、`go vet` 通过 | macOS arm64 上的本地测试，新增 7 个顶层测试及 HTTP 状态子用例 |
| Agent Linux 编译 | amd64、arm64 均通过 | 静态 ELF 产物；不是 Linux 实机运行验收 |
| 后端 / 前端构建与类型 | 通过 | Nest build、Next production build、TypeScript |
| ESLint / diff check | 通过 | 不回退原工作区已有变更 |
| 浏览器全量回归 | 9 个脚本通过 | 合成 API、外部网络阻断，包括既有部署、订阅、使用观测、资源清理和协议页面 |
| 硬件卡片最终补测 | 4 组通过 | 1440/390 px x light/dark，含无字段、未知 schema、转义和无写操作 |

首次全量 Jest 揭示旧安全测试模块缺少新服务注入，已补齐测试装配并全量重跑通过。最后的前端降级防护修改后重新构建并重跑硬件卡片四组检查通过。

非阻断提示：既有 macOS `go-m1cpu` C 编译警告、Node deprecation/localstorage 警告，以及 Next 提示未检测到其专用 ESLint plugin。没有通过关闭检查绕过失败。

## 本地证据

均位于 `out/hardware-info-20261111/`，不包含生产采集数据：

- `jest-results.json`、`jest.log`
- `go-test.log`
- `postgres.log`
- `web-build.log`
- `browser-regression.log`、`hardware-browser.log`
- `hardware-1440-light.png`、`hardware-1440-dark.png`
- `hardware-390-light.png`、`hardware-390-dark.png`
- `agent-linux-amd64`、`agent-linux-arm64`

构建产物 SHA-256：

```text
27287e5d76db4a89f274d12307830c5b1a455361d7435da78b5dfeb33923dddc  agent-linux-amd64
ce33bd50d78beff215fa75310e9683d992905f3c5ca032f211155f262b94be41  agent-linux-arm64
```

## 未执行的验收

- GitHub CI / PR / 发布流程未执行。
- 生产数据库迁移、面板部署、Agent 发布与升级未执行。
- 真实 Linux amd64/arm64 VPS 的采集准确性、虚拟化识别和升级前后节点业务不变量仍需单台试点验收。

上线顺序、时效口径、退避和兼容回滚见 `docs/RUNBOOK-server-hardware.md`。
