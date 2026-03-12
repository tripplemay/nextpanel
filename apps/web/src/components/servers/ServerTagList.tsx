'use client';

import { useState } from 'react';
import { Tag, Popover, Input, Button, Space, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined, LockOutlined } from '@ant-design/icons';
import { tagColor } from '@/lib/tag-color';

interface Props {
  tags: string[];
  autoTags: string[];
  /** Called when a manual tag is renamed (returns new tag list) */
  onRename?: (oldName: string, newName: string) => void;
  /** Called when a manual tag is deleted */
  onDelete?: (name: string) => void;
  /** If true, no edit interactions (list view) */
  readonly?: boolean;
}

function ManualTag({ name, onRename, onDelete }: {
  name: string;
  onRename?: (oldName: string, newName: string) => void;
  onDelete?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editValue, setEditValue] = useState(name);

  function handleRename() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename?.(name, trimmed);
    }
    setOpen(false);
  }

  const content = (
    <Space direction="vertical" size={8} style={{ width: 180 }}>
      <Input
        size="small"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onPressEnter={handleRename}
        autoFocus
      />
      <Space>
        <Button size="small" type="primary" icon={<EditOutlined />} onClick={handleRename}>
          改名
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => { onDelete?.(name); setOpen(false); }}
        >
          删除
        </Button>
      </Space>
    </Space>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      content={content}
      title="编辑标签"
      trigger="click"
      placement="bottom"
    >
      <Tag
        color={tagColor(name)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {name}
      </Tag>
    </Popover>
  );
}

function AutoTag({ name }: { name: string }) {
  return (
    <Tooltip title="自动标签，由 IP 检测结果生成">
      <Tag
        color={tagColor(name)}
        icon={<LockOutlined style={{ fontSize: 10 }} />}
        style={{ fontStyle: 'italic', cursor: 'default', userSelect: 'none' }}
      >
        {name}
      </Tag>
    </Tooltip>
  );
}

export default function ServerTagList({ tags, autoTags, onRename, onDelete, readonly }: Props) {
  return (
    <>
      {tags.map((t) =>
        readonly ? (
          <Tag key={t} color={tagColor(t)}>{t}</Tag>
        ) : (
          <ManualTag key={t} name={t} onRename={onRename} onDelete={onDelete} />
        )
      )}
      {autoTags.map((t) => (
        <AutoTag key={`auto:${t}`} name={t} />
      ))}
    </>
  );
}
