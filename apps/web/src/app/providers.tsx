'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useMemo, useState } from 'react';
import { ThemeProvider, useThemeMode } from '@/theme/ThemeContext';
import { buildAntdTheme } from '@/theme/antd-theme';

function ThemedConfigProvider({ children }: { children: React.ReactNode }) {
  const { resolvedMode } = useThemeMode();
  const themeConfig = useMemo(() => buildAntdTheme(resolvedMode), [resolvedMode]);
  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <App>{children}</App>
    </ConfigProvider>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ThemedConfigProvider>{children}</ThemedConfigProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
