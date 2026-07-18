# 技术设计：前端性能重构

**日期**：2026-03-07
**状态**：已完成并上线
**commit**：`372d086`

---

## 背景

前端存在三类性能问题：

1. **请求层**：多个页面每 10s 无条件轮询，产生大量无效网络请求
2. **渲染层**：columns 定义、批量测试结果更新等触发不必要的全量重渲染
3. **内存层**：Modal/Drawer 关闭后组件仍挂载，持续占用内存

---

## 一、请求层优化

### 1.1 去掉自动轮询

**问题**：`nodes`、`servers`、`subscriptions` 三个 query 均设置了 `refetchInterval: 10_000`，即使页面无操作也每 10 秒发一次请求。节点/服务器数据只有在用户操作后才会变化，轮询完全多余。

**方案**：去掉 `refetchInterval`，改为操作后手动 `invalidateQueries`。

**安全网设计（降低风险）**：
- 不用 `staleTime: Infinity`，改为 `staleTime: 2 * 60 * 1000`（节点/服务器）——2 分钟后数据自然过期，作为最终兜底
- 保留默认的 `refetchOnWindowFocus: true`——用户从其他 tab 切回时自动刷新，覆盖「他人操作后用户切回来」场景

**改前审计**：检查所有 mutation 是否均有 `invalidateQueries`，确认覆盖完整后再去掉轮询。

### 1.2 staleTime 分层

| 资源类型 | staleTime | 理由 |
|---|---|---|
| nodes、servers | 2 分钟 | 操作后手动 invalidate，2min 作兜底 |
| audit-logs、subscriptions、users、invite-codes | 5 分钟 | 数据变化极低频，用户会话内反复切页不需重复请求 |
| 全局默认 | 30 秒（不变） | 覆盖其他未单独配置的 query |

### 1.3 Token 读取优化

**问题**：Axios 请求拦截器、`useDeployStream`、`startBatchTest` 三处均直接调用 `localStorage.getItem('access_token')`，每次请求都访问 localStorage。

**方案**：改用 `useAuthStore.getState().token`（Zustand 的 `getState()` 可在 React 之外调用），token 只在 store 初始化时从 localStorage 读取一次。

附带修复：401 响应拦截器的 `localStorage.removeItem` 改为 `useAuthStore.getState().logout()`，确保 store 状态与 localStorage 同步清理。

### 改动文件

- `apps/web/src/lib/api.ts`
- `apps/web/src/hooks/useDeployStream.ts`
- `apps/web/src/app/(dashboard)/nodes/page.tsx`（`startBatchTest`）
- `apps/web/src/app/(dashboard)/subscriptions/page.tsx`
- `apps/web/src/app/(dashboard)/audit-logs/page.tsx`
- `apps/web/src/app/(dashboard)/users/page.tsx`
- `apps/web/src/app/(dashboard)/invite-codes/page.tsx`

---

## 二、渲染层优化

### 2.1 columns useMemo

**问题**：nodes/page.tsx 的 `columns` 数组在函数体内直接定义，每次父组件 re-render 都会重建整个 columns 对象（包含 render 函数），触发 Table 内部 diff。

**方案**：用 `useMemo` 包裹，依赖项：`[testResults, testingId, batchTesting, togglingId, toggleMutation, testMutation, modal, openDeploy, openDelete, openRename]`。

**前置条件**：`openDeploy`、`openDelete`、`openRename` 三个函数需用 `useCallback` 包裹，才能作为稳定 dep：

```ts
const openDeploy = useCallback((node: Node) => {
  reset();
  setDeployingNode(node);
  setDrawerOpen(true);
  void startStream(`/api/nodes/${node.id}/deploy-stream`, (success) => {
    if (success) qc.invalidateQueries({ queryKey: ['nodes'] });
  });
}, [reset, startStream, qc]);
```

`reset` 和 `startStream` 来自 `useDeployStream`，均已用 `useCallback(fn, [])` 包裹，引用稳定。

### 2.2 搜索框防抖

**问题**：servers/page.tsx 搜索框 `onChange` 直接调用 `setSearchText`，每次击键触发一次 `filteredData` 的 `useMemo` 重计算。

**方案**：用 `useRef` 存储 timer，300ms 防抖。

```ts
const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

onChange={(e) => {
  const value = e.target.value;
  if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  searchTimerRef.current = setTimeout(() => setSearchText(value), 300);
}}
```

### 改动文件

- `apps/web/src/app/(dashboard)/nodes/page.tsx`
- `apps/web/src/app/(dashboard)/servers/page.tsx`

---

## 三、内存层优化

### destroyOnClose

**问题**：Modal 关闭后组件默认仍挂载（Ant Design 行为），内部 state 和 query 仍占用内存。

**方案**：对关闭后内容无复用价值的 Modal 加 `destroyOnClose`。

**判断标准**：

| Modal | 处理方式 | 理由 |
|---|---|---|
| rename Modal | 加 `destroyOnClose` | 下次打开时必然重置，无需保留 |
| NodeShareModal | 在组件内部加 | 关闭后分享链接无意义 |
| DeployLogModal | 在组件内部加 | 关闭后日志列表无意义 |
| NodePresetModal | 不加 | 加了反而导致每次打开重新请求预设列表，TanStack Query 缓存失效 |
| DeployDrawer | 不加 | 关闭时已调用 `abort()` + `reset()`，行为等价 |

### 改动文件

- `apps/web/src/app/(dashboard)/nodes/page.tsx`
- `apps/web/src/components/nodes/NodeShareModal.tsx`
- `apps/web/src/components/nodes/DeployLogModal.tsx`

---

## 四、规范修正（audit-logs）

**问题**：

1. 页面头部用 `<Title level={4}>` 而非 `<PageHeader>`，不符合项目规范
2. `hasDiff` / `hasSshLog` 判断逻辑在 `ExpandedRowContent` 和 `rowExpandable` 中重复定义

**方案**：

1. 替换为 `<PageHeader title="审计日志" extra={<Select .../>} />`
2. 提取为独立函数：

```ts
function hasDiff(record: AuditLog): boolean { ... }
function hasSshLog(record: AuditLog): boolean { ... }
```

两处调用点均改为 `hasDiff(record)` / `hasSshLog(record)`。

### 改动文件

- `apps/web/src/app/(dashboard)/audit-logs/page.tsx`

---

## 跳过的优化项

| 优化项 | 跳过理由 |
|---|---|
| testResults → useRef + 局部更新 | 节点数少时无感知；columns 已 useMemo，收益边际化；有卡顿再做 |
| servers/page.tsx columns useMemo | 无高频状态变化；wrapping 需额外 useCallback 链，成本不匹配收益 |
| 大组件拆分（nodes/servers 页） | 纯数据 hooks 体量小；Mutation 强耦合 UI 状态，提取后复杂度反升；请求层+渲染层优化已覆盖主要问题 |

---

## 踩坑记录

1. **destroyOnClose 不应透传**：调用方加 `destroyOnClose` prop 会因子组件 interface 未声明而报 TS 错误。正确做法是在组件内部的 `<Modal>` 直接加，不需要 prop 透传。
2. **去掉 import 时检查全文引用**：从 audit-logs 页面移除 `Space` import 时未检查组件内部还有使用，导致 TS 错误。改 import 前需全文搜索确认。
