'use client';

import { useRef, useEffect } from 'react';
import { App, Button, Tooltip } from 'antd';
import { CopyOutlined, DownloadOutlined, LoadingOutlined } from '@ant-design/icons';
import { useThemeTokens } from '@/theme/ThemeContext';
import type { NpTokens } from '@/theme/tokens';

export type LogStatus = 'idle' | 'running' | 'success' | 'failed';

interface LogTerminalProps {
  lines: string[];
  status?: LogStatus;
  /** 无日志且运行中时的占位文案 */
  runningText?: string;
  /** 成功时在末尾渲染的状态行（不传则不渲染） */
  successText?: string;
  /** 失败时在末尾渲染的状态行（不传则不渲染） */
  failedText?: string;
  minHeight?: number;
  maxHeight?: number | string;
  style?: React.CSSProperties;
}

function lineColor(line: string, tokens: NpTokens): string {
  if (/error|failed|失败|错误|✗/i.test(line)) return tokens.logError;
  if (/成功|完成|completed|success|\bOK\b|已停止|已删除|✓/.test(line) || line.trimStart().startsWith('===')) {
    return tokens.logSuccess;
  }
  if (line.trimStart().startsWith('---')) return tokens.logMuted;
  return tokens.logText;
}

/**
 * 统一的暗色日志终端（部署/卸载/Agent 安装/自动配置/历史日志共用）。
 * 自带关键字着色、自动滚底、复制全文与下载。
 */
export default function LogTerminal({
  lines,
  status = 'idle',
  runningText = '正在连接服务器...',
  successText,
  failedText,
  minHeight = 200,
  maxHeight,
  style,
}: LogTerminalProps) {
  const tokens = useThemeTokens();
  const { message } = App.useApp();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lines.length > 0) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [lines]);

  const fullText = lines.join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      message.success('日志已复制');
    } catch {
      message.error('复制失败');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nextpanel-log-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ position: 'relative' }}>
      {lines.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            zIndex: 2,
            display: 'flex',
            gap: 2,
            opacity: 0.65,
          }}
        >
          <Tooltip title="复制全部">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={handleCopy}
              style={{ color: tokens.logMuted }}
            />
          </Tooltip>
          <Tooltip title="下载日志">
            <Button
              size="small"
              type="text"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              style={{ color: tokens.logMuted }}
            />
          </Tooltip>
        </div>
      )}
      <div
        style={{
          background: tokens.logBg,
          color: tokens.logText,
          fontFamily: 'monospace',
          fontSize: 13,
          padding: 16,
          borderRadius: 6,
          minHeight,
          maxHeight,
          overflowY: maxHeight ? 'auto' : undefined,
          lineHeight: 1.7,
          ...style,
        }}
      >
        {lines.length === 0 && status === 'running' && (
          <span style={{ color: tokens.logMuted }}>
            <LoadingOutlined style={{ marginRight: 8 }} />
            {runningText}
          </span>
        )}
        {lines.map((line, i) => (
          <div key={i} style={{ color: lineColor(line, tokens) }}>
            {line}
          </div>
        ))}
        {status === 'success' && successText && (
          <div style={{ color: tokens.logSuccess, marginTop: 8 }}>✓ {successText}</div>
        )}
        {status === 'failed' && failedText && (
          <div style={{ color: tokens.logError, marginTop: 8 }}>✗ {failedText}</div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
