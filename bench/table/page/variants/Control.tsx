// C, the control: a scroller of plain `div` rows, windowed with the same engine and the same overscan and step as the table (the kit's
// `useVirtualRows`, source), nothing else. It fixes what the machine and the engine give an empty windowed scroller: the p95 floor.
import { useRef } from 'react';
import { useVirtualRows } from '../../../../packages/kit/src/table/useVirtualRows';
import type { Probe } from '../harness';
import type { VariantProps } from '../variant';

const HEADER = 25;
const ROW = 40;

export const probe: Probe = {
  scroller: () => document.querySelector<HTMLElement>('[data-bench-scroller]'),
  body: () => document.querySelector<HTMLElement>('[data-bench-body]'),
  indexAttribute: 'data-index',
  headerHeight: () => HEADER,
  sortControl: () => null,
};

export default function ControlVariant({ rows, overscan, rangeStep }: VariantProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const windowed = useVirtualRows({ count: rows.length, getScrollElement: () => scroller.current, rowHeight: ROW, overscan, rangeStep });
  return (
    <div className="stage">
      <div ref={scroller} data-bench-scroller="" style={{ height: '100%', overflow: 'auto', position: 'relative', color: '#d5d7db', font: '13px/16px system-ui, sans-serif' }}>
        <div style={{ position: 'sticky', top: 0, height: HEADER, zIndex: 2, background: '#25282d' }}>Name</div>
        <div data-bench-body="" style={{ position: 'relative', height: windowed.totalSize }}>
          {windowed.items.map((item) => {
            const row = rows[item.index];
            return row === undefined ? null : (
              <div key={row.key} data-index={item.index} style={{ position: 'absolute', insetBlockStart: 0, insetInline: 0, height: ROW, transform: `translateY(${item.start}px)` }}>
                {row.name}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
