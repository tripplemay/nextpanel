'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getTokens, type NpTokens, type ResolvedTheme } from './tokens';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'np-theme-mode';

interface ThemeContextValue {
  /** 用户选择的模式（含 system） */
  mode: ThemeMode;
  /** 实际生效的亮/暗模式 */
  resolvedMode: ResolvedTheme;
  /** 当前模式下的自定义语义 token */
  tokens: NpTokens;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolvedMode: 'light',
  tokens: getTokens('light'),
  setMode: () => {},
});

function resolveSystem(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyToDom(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/**
 * 主题状态管理。
 *
 * 注意：初始渲染始终为 light（与 SSR 输出一致，避免水合不匹配），
 * 挂载后由 effect 同步真实偏好。layout.tsx 中的内联脚本已在首次绘制前
 * 写好了 data-theme 与 body 背景，因此切换几乎无感知闪烁。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolvedMode, setResolvedMode] = useState<ResolvedTheme>('light');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    const initial: ThemeMode =
      stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    setModeState(initial);
    const resolved = initial === 'system' ? resolveSystem() : initial;
    applyToDom(resolved);
    setResolvedMode(resolved);
  }, []);

  // system 模式下跟随操作系统切换
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const resolved = resolveSystem();
      applyToDom(resolved);
      setResolvedMode(resolved);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
    const resolved = next === 'system' ? resolveSystem() : next;
    applyToDom(resolved);
    setResolvedMode(resolved);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedMode, tokens: getTokens(resolvedMode), setMode }),
    [mode, resolvedMode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** 便捷 hook：只取自定义语义 token */
export function useThemeTokens(): NpTokens {
  return useContext(ThemeContext).tokens;
}
