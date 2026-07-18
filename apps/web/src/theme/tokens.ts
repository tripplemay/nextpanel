/**
 * NextPanel 自定义语义 token —— 用于 AntD 组件之外的场景：
 * 日志终端、图表、拓扑画布、侧边栏/头部布局、卡片阴影。
 *
 * AntD 组件自身的颜色请优先使用 `theme.useToken()`（colorSuccess 等），
 * 不要在本文件重复定义；本文件只覆盖 AntD token 管不到的场景。
 *
 * CSS 场景（如 Topology.module.css）通过 `:global([data-theme='dark'])`
 * 选择器适配暗色，取值需与本文件保持一致。
 */

export type ResolvedTheme = 'light' | 'dark';

export interface NpTokens {
  /** 日志终端 */
  logBg: string;
  logText: string;
  logMuted: string;
  logError: string;
  logSuccess: string;
  /** 图表（recharts 网格线/坐标轴文字） */
  chartGrid: string;
  chartText: string;
  /** 节点拓扑画布与节点卡 */
  topologyBg: string;
  topologyNodeBg: string;
  topologyNodeBorder: string;
  /** 仪表盘布局表面 */
  sidebarBg: string;
  sidebarBorder: string;
  headerBg: string;
  contentBg: string;
  /** 卡片阴影（静态 / hover 抬升） */
  cardShadow: string;
  cardShadowHover: string;
}

export const lightTokens: NpTokens = {
  logBg: '#0d1117',
  logText: '#c9d1d9',
  logMuted: '#8b949e',
  logError: '#f85149',
  logSuccess: '#3fb950',
  chartGrid: '#f0f0f0',
  chartText: '#8c8c8c',
  topologyBg: '#f5f7fa',
  topologyNodeBg: '#ffffff',
  topologyNodeBorder: '#e5e7eb',
  sidebarBg: '#ffffff',
  sidebarBorder: '#f0f0f0',
  headerBg: 'rgba(255, 255, 255, 0.8)',
  contentBg: '#f5f7fa',
  cardShadow: '0 1px 2px rgba(0, 0, 0, 0.04), 0 2px 8px rgba(0, 0, 0, 0.06)',
  cardShadowHover: '0 6px 16px rgba(0, 0, 0, 0.10)',
};

export const darkTokens: NpTokens = {
  logBg: '#0d1117',
  logText: '#c9d1d9',
  logMuted: '#8b949e',
  logError: '#ff7b72',
  logSuccess: '#56d364',
  chartGrid: '#21262d',
  chartText: '#8b949e',
  topologyBg: '#0d1117',
  topologyNodeBg: '#161b22',
  topologyNodeBorder: '#30363d',
  sidebarBg: '#010409',
  sidebarBorder: '#21262d',
  headerBg: 'rgba(22, 27, 34, 0.8)',
  contentBg: '#0d1117',
  cardShadow: '0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.3)',
  cardShadowHover: '0 6px 16px rgba(0, 0, 0, 0.5)',
};

export function getTokens(mode: ResolvedTheme): NpTokens {
  return mode === 'dark' ? darkTokens : lightTokens;
}
