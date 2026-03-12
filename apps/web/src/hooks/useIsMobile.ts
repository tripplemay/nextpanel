'use client';

import { Grid } from 'antd';

export function useIsMobile() {
  const screens = Grid.useBreakpoint();
  return {
    isMobile: !screens.md,
    isTablet: !!screens.md && !screens.lg,
  };
}
