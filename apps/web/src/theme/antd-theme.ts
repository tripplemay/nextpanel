import { theme, type ThemeConfig } from 'antd';
import type { ResolvedTheme } from './tokens';

/**
 * 由亮/暗模式构建 AntD ConfigProvider 主题。
 *
 * 设计语言：Linear / Vercel 风格的现代中性配方 —
 * 去饱和 zinc 系中性色、细边框代替阴影、6px 圆角、紧凑密度、
 * Inter 字体 + 全局 tabular-nums（globals.css）。
 * 自定义语义场景（日志终端、拓扑等）见 tokens.ts。
 */

const FONT_FAMILY =
  "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif";

export function buildAntdTheme(mode: ResolvedTheme): ThemeConfig {
  const isDark = mode === 'dark';
  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: '#1677ff',
      colorInfo: '#1677ff',
      fontFamily: FONT_FAMILY,
      fontSize: 14,
      fontWeightStrong: 600,
      borderRadius: 6,
      colorBgLayout: isDark ? '#0a0a0b' : '#fafafa',
      ...(isDark
        ? {
            // 暗色：zinc 系深灰（近 Linear/Vercel 暗色）
            colorBgContainer: '#141416',
            colorBgElevated: '#1b1b1f',
            colorBorder: '#26262b',
            colorBorderSecondary: '#1c1c21',
            colorText: '#f4f4f5',
            colorTextSecondary: '#a1a1aa',
            colorTextTertiary: '#71717a',
            colorTextQuaternary: '#52525b',
            colorFillAlter: '#1b1b1f',
          }
        : {
            // 亮色：zinc 系中性灰
            colorBgContainer: '#ffffff',
            colorBgElevated: '#ffffff',
            colorBorder: '#e4e4e7',
            colorBorderSecondary: '#f0f0f2',
            colorText: '#18181b',
            colorTextSecondary: '#52525b',
            colorTextTertiary: '#71717a',
            colorTextQuaternary: '#a1a1aa',
            colorFillAlter: '#fafafa',
          }),
    },
    components: {
      Card: { borderRadiusLG: 8 },
      Menu: isDark
        ? {
            itemHeight: 36,
            itemBorderRadius: 6,
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemColor: 'rgba(244, 244, 245, 0.72)',
            darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
            darkItemSelectedBg: 'rgba(22, 119, 255, 0.16)',
            darkItemSelectedColor: '#ffffff',
          }
        : {
            itemHeight: 36,
            itemBorderRadius: 6,
            itemBg: 'transparent',
            subMenuItemBg: 'transparent',
            itemColor: 'rgba(24, 24, 27, 0.72)',
            itemHoverBg: 'rgba(24, 24, 27, 0.04)',
            itemSelectedBg: 'rgba(22, 119, 255, 0.08)',
            itemSelectedColor: '#1677ff',
          },
      Table: isDark
        ? {
            headerBg: '#17171a',
            headerSplitColor: 'transparent',
            borderColor: '#1c1c21',
            cellPaddingBlock: 10,
          }
        : {
            headerBg: '#fafafa',
            headerSplitColor: 'transparent',
            borderColor: '#f0f0f2',
            cellPaddingBlock: 10,
          },
      Button: {
        borderRadius: 6,
        primaryShadow: 'none',
      },
      Tabs: {
        horizontalMargin: '0 0 16px 0',
      },
    },
  };
}
