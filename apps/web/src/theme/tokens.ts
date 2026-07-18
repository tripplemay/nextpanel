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
  chartGrid: '#f0f0f2',
  chartText: '#a1a1aa',
  topologyBg: '#fafafa',
  topologyNodeBg: '#ffffff',
  topologyNodeBorder: '#e4e4e7',
  sidebarBg: '#fafafa',
  sidebarBorder: '#e4e4e7',
  headerBg: 'rgba(250, 250, 250, 0.75)',
  contentBg: '#fafafa',
  cardShadow: '0 1px 2px rgba(16, 24, 40, 0.04)',
  cardShadowHover: '0 4px 12px rgba(16, 24, 40, 0.08)',
};

export const darkTokens: NpTokens = {
  logBg: '#0d1117',
  logText: '#c9d1d9',
  logMuted: '#8b949e',
  logError: '#ff7b72',
  logSuccess: '#56d364',
  chartGrid: '#1c1c21',
  chartText: '#52525b',
  topologyBg: '#0a0a0b',
  topologyNodeBg: '#141416',
  topologyNodeBorder: '#26262b',
  sidebarBg: '#0a0a0b',
  sidebarBorder: '#1c1c21',
  headerBg: 'rgba(10, 10, 11, 0.72)',
  contentBg: '#0a0a0b',
  cardShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
  cardShadowHover: '0 4px 12px rgba(0, 0, 0, 0.55)',
};

export function getTokens(mode: ResolvedTheme): NpTokens {
  return mode === 'dark' ? darkTokens : lightTokens;
}
