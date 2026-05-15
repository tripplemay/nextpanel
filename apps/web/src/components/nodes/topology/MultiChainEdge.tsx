'use client';

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { ChainTopologyEdge } from './types';
import styles from './Topology.module.css';

export default function MultiChainEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<ChainTopologyEdge>) {
  const chainNodes = data?.chainNodes ?? [];
  const colors = data?.colors.length ? data.colors : ['#2563eb'];
  const count = Math.max(chainNodes.length, colors.length, 1);
  const [labelPath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <path d={labelPath} className={styles.edgeHitArea} />
      {Array.from({ length: count }).map((_, index) => {
        const offset = (index - (count - 1) / 2) * 5;
        const [path] = getBezierPath({
          sourceX,
          sourceY: sourceY + offset,
          sourcePosition,
          targetX,
          targetY: targetY + offset,
          targetPosition,
        });

        return (
          <BaseEdge
            key={`${id}:${index}`}
            id={`${id}:${index}`}
            path={path}
            style={{
              stroke: colors[index % colors.length],
              strokeWidth: selected ? 5 : 4,
              opacity: selected ? 1 : 0.86,
            }}
          />
        );
      })}
      <EdgeLabelRenderer>
        <div
          className={`${styles.edgeLabel} ${selected ? styles.edgeLabelSelected : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
        >
          {chainNodes.length} 条链路
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
