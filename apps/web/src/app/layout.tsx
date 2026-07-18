import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import localFont from 'next/font/local';
import Providers from './providers';
import './globals.css';

// Inter 可变字体自托管（拉丁/数字用 Inter，中文回退系统字体）
const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  fallback: [
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'PingFang SC',
    'Microsoft YaHei',
    'sans-serif',
  ],
});

export const metadata: Metadata = {
  title: 'NextPanel',
  description: 'Multi-protocol proxy panel',
};

// 首次绘制前根据用户偏好写入 data-theme 与 color-scheme，避免暗色用户看到亮色闪烁
const themeInitScript = `(function(){try{var m=localStorage.getItem('np-theme-mode')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
