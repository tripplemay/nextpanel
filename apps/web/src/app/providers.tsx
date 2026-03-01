'use client';

import '@ant-design/v5-patch-for-react-19';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useState } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: { colorPrimary: '#1677ff', borderRadius: 8 },
        }}
      >
        <App>{children}</App>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
