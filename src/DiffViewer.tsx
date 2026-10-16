import { useMemo, useState } from 'react';
import { parseUnifiedDiff, splitDiffRows } from './unified-diff';
import type { Messages } from './i18n';

export function DiffViewer({
  text,
  layout,
  wrap,
  t,
}: {
  text: string;
  layout: 'unified' | 'split';
  wrap: boolean;
  t: Messages;
}) {
  const lines = useMemo(() => parseUnifiedDiff(text), [text]);
  const rows = useMemo(() => (layout === 'split' ? splitDiffRows(lines) : []), [lines, layout]);
  const splitWidth = useMemo(
    () =>
      lines.reduce(
        (width, line) =>
          ['add', 'remove', 'context'].includes(line.type)
            ? Math.max(width, line.line.replaceAll('\t', '  ').length)
            : width,
        40,
      ) *
        2 +
      12,
    [lines],
  );
  const [limit, setLimit] = useState(500);
  const total = layout === 'split' ? rows.length : lines.length;
  if (!text) return <p className="diff-notice">{t.noDiff}</p>;
  return (
    <div
      className={`diff-scroll ${wrap ? 'wrap-lines' : ''}`}
      tabIndex={0}
      aria-label={t.diffContent}
    >
      {layout === 'unified' ? (
        <table className="diff-table" aria-label={t.unifiedDiff}>
          <tbody>
            {lines.slice(0, limit).map((line) => (
              <tr className={line.type} key={line.index}>
                <td className="line-number">{line.old}</td>
                <td className="line-number">{line.next}</td>
                <td className="line-sign">
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ''}
                </td>
                <td className="line-content">
                  <pre>{line.line || ' '}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table
          className="diff-table split-diff"
          aria-label={t.splitDiff}
          style={!wrap ? { minWidth: `max(680px, ${splitWidth}ch)` } : undefined}
        >
          <colgroup>
            <col className="number-col" />
            <col />
            <col className="number-col" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={2}>{t.beforeChange}</th>
              <th colSpan={2}>{t.afterChange}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, index) =>
              row.type === 'meta' || row.type === 'hunk' ? (
                <tr className={row.type} key={index}>
                  <td className="line-content" colSpan={4}>
                    <pre>{row.text || ' '}</pre>
                  </td>
                </tr>
              ) : (
                <tr key={index}>
                  <td className={`line-number ${row.left?.type || 'absent'}`}>{row.left?.old}</td>
                  <td className={`line-content ${row.left?.type || 'absent'}`}>
                    <pre>{row.left?.line || ' '}</pre>
                  </td>
                  <td className={`line-number ${row.right?.type || 'absent'}`}>
                    {row.right?.next}
                  </td>
                  <td className={`line-content ${row.right?.type || 'absent'}`}>
                    <pre>{row.right?.line || ' '}</pre>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {total > limit && (
        <div className="diff-pagination">
          <span>
            {t.diffRows}: {limit} / {total}
          </span>
          <button className="button secondary" onClick={() => setLimit((value) => value + 500)}>
            {t.loadMoreDiff}
          </button>
        </div>
      )}
    </div>
  );
}
