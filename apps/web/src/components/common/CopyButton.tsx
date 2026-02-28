'use client';

import { useState } from 'react';
import { Button } from 'antd';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';

interface CopyButtonProps {
  text: string;
  size?: 'small' | 'middle' | 'large';
}

export default function CopyButton({ text, size = 'small' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      size={size}
      icon={copied ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined />}
      onClick={copy}
    >
      {copied ? '已复制' : '复制'}
    </Button>
  );
}
