import { theme, type ThemeConfig } from 'antd';
import type { ResolvedTheme } from './tokens';

/**
 * 由亮/暗模式构建 AntD ConfigProvider 主题。
 * 自定义语义场景（日志终端、拓扑等）见 tokens.ts。
 */
export function buildAntdTheme(mode: ResolvedTheme): ThemeConfig {
  const isDark = mode === 'dark';
  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: '#1677ff',
      colorInfo: '#1677ff',
      borderRadius: 8,
      colorBgLayout: isDark ? '#0d1117' : '#f5f7fa',
      ...(isDark
        ? {
            colorBgContainer: '#161b22',
            colorBgElevated: '#21262d',
            colorBorder: '#30363d',
            colorBorderSecondary: '#21262d',
          }
        : {}),
    },
    components: {
      Card: { borderRadiusLG: 10 },
      Menu: isDark
        ? {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemColor: 'rgba(230, 237, 243, 0.75)',
            darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
            darkItemSelectedBg: 'rgba(22, 119, 255, 0.18)',
            darkItemSelectedColor: '#ffffff',
          }
        : {
            itemBg: 'transparent',
            subMenuItemBg: 'transparent',
            itemColor: 'rgba(0, 0, 0, 0.72)',
            itemHoverBg: 'rgba(0, 0, 0, 0.04)',
            itemSelectedBg: 'rgba(22, 119, 255, 0.10)',
            itemSelectedColor: '#1677ff',
          },
    },
  };
}
