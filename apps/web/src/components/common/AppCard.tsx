'use client';

import { useState } from 'react';
import { Card, type CardProps } from 'antd';
import { useThemeTokens } from '@/theme/ThemeContext';

interface AppCardProps extends CardProps {
  /** hover 时抬升并加深阴影（可点击卡片使用） */
  hoverable?: boolean;
}

/**
 * 统一卡片规范：主题化分层阴影 + 可选 hover 抬升。
 * 代替各页面裸用 `<Card style={{ boxShadow: ... }}>`。
 */
export default function AppCard({ hoverable = false, style, onMouseEnter, onMouseLeave, ...rest }: AppCardProps) {
  const tokens = useThemeTokens();
  const [hover, setHover] = useState(false);

  return (
    <Card
      {...rest}
      style={{
        boxShadow: hover && hoverable ? tokens.cardShadowHover : tokens.cardShadow,
        transform: hover && hoverable ? 'translateY(-2px)' : 'none',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        ...style,
      }}
      onMouseEnter={(e) => {
        setHover(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHover(false);
        onMouseLeave?.(e);
      }}
    />
  );
}
