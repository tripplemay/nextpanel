import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'NextPanel',
  description: 'Multi-protocol proxy panel',
};

// 首次绘制前根据用户偏好写入 data-theme 与 color-scheme，避免暗色用户看到亮色闪烁
const themeInitScript = `(function(){try{var m=localStorage.getItem('np-theme-mode')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
