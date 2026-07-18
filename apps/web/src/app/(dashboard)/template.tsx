'use client';

/**
 * 页面切换过渡：导航时淡入 + 轻微上移。
 * template.tsx 在每次路由变化时重新挂载，触发动画重放。
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="np-page-enter">{children}</div>;
}
