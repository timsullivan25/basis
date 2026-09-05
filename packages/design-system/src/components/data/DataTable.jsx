import React from 'react';
import { Icon } from '../primitives/Icon.jsx';
import { Checkbox } from '../forms/Checkbox.jsx';

/** Dense sortable table with optional group rows and expandable detail. */
export function DataTable({
  columns = [], rows = [], rowKey = 'id', dense = false, striped = false,
  sort, onSortChange, selectable = false, selected = [], onSelectedChange,
  expandedKey, onRowClick, renderDetail, stickyHeader = true, maxHeight, style, ...rest
}) {
  const h = dense ? 'var(--row-h-dense)' : 'var(--row-h)';
  const [hoverRow, setHoverRow] = React.useState(null);
  const allSel = selectable && rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => onSelectedChange && onSelectedChange(allSel ? [] : rows.map((r) => r[rowKey]));
  const toggleRow = (k) => onSelectedChange && onSelectedChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  const align = (c) => c.align || (c.numeric ? 'right' : 'left');

  return (
    <div style={{ overflow: 'auto', maxHeight, ...style }} {...rest}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--font-sans)', fontSize: dense ? 'var(--text-xs)' : 'var(--text-sm)' }}>
        <thead>
          <tr>
            {selectable ? (
              <th style={{ position: stickyHeader ? 'sticky' : 'static', top: 0, zIndex: 2, width: 30, height: 'var(--subbar-h)', padding: '0 var(--space-5)', background: 'var(--surface-table-head)', borderBottom: '1px solid var(--border-default)' }}>
                <Checkbox checked={allSel} indeterminate={!allSel && selected.length > 0} onChange={toggleAll} />
              </th>
            ) : null}
            {columns.map((c) => {
              const active = sort && sort.key === c.key;
              return (
                <th
                  key={c.key}
                  onClick={() => c.sortable !== false && onSortChange && onSortChange({ key: c.key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
                  style={{
                    position: stickyHeader ? 'sticky' : 'static', top: 0, zIndex: 2,
                    height: 'var(--subbar-h)', padding: '0 var(--space-6)', width: c.width,
                    textAlign: align(c), whiteSpace: 'nowrap',
                    fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)',
                    letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    background: 'var(--surface-table-head)', borderBottom: '1px solid var(--border-default)',
                    cursor: c.sortable === false ? 'default' : 'pointer', userSelect: 'none',
                  }}
                  title={c.description}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexDirection: align(c) === 'right' ? 'row-reverse' : 'row' }}>
                    {c.label}
                    {active ? <Icon name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={10} color="var(--text-brand)" /> : null}
                    {c.description ? <Icon name="info" size={10} color="var(--text-tertiary)" /> : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const k = r[rowKey];
            const isGroup = r.__group;
            const expanded = expandedKey === k;
            if (isGroup) {
              return (
                <tr key={k}>
                  <td colSpan={columns.length + (selectable ? 1 : 0)} style={{ height: 'var(--control-sm)', padding: '0 var(--space-6)', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    {r.__group}
                  </td>
                </tr>
              );
            }
            const hovered = hoverRow === k;
            return (
              <React.Fragment key={k}>
                <tr
                  onMouseEnter={() => setHoverRow(k)} onMouseLeave={() => setHoverRow(null)}
                  onClick={() => onRowClick && onRowClick(r)}
                  style={{
                    background: expanded ? 'var(--surface-selected)' : hovered ? 'var(--surface-hover)' : (striped && i % 2 ? 'var(--surface-table-stripe)' : 'transparent'),
                    cursor: onRowClick ? 'pointer' : 'default', transition: 'background-color var(--dur-instant) var(--ease-out)',
                  }}
                >
                  {selectable ? (
                    <td style={{ padding: '0 var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.includes(k)} onChange={() => toggleRow(k)} />
                    </td>
                  ) : null}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        height: h, padding: '0 var(--space-6)', textAlign: align(c),
                        borderBottom: '1px solid var(--border-subtle)',
                        fontFamily: c.numeric ? 'var(--font-mono)' : 'var(--font-sans)',
                        fontVariantNumeric: c.numeric ? 'var(--numeric-tabular)' : undefined,
                        fontWeight: c.emphasis ? 'var(--weight-medium)' : 'var(--weight-regular)',
                        color: c.muted ? 'var(--text-secondary)' : 'var(--text-body)',
                        whiteSpace: 'nowrap', maxWidth: c.maxWidth, overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {c.render ? c.render(r[c.key], r) : r[c.key]}
                    </td>
                  ))}
                </tr>
                {expanded && renderDetail ? (
                  <tr>
                    <td colSpan={columns.length + (selectable ? 1 : 0)} style={{ padding: 0, background: 'var(--surface-app)', borderBottom: '1px solid var(--border-default)' }}>
                      <div style={{ padding: 'var(--space-8)', animation: 'basis-fade-in var(--dur-base) var(--ease-out)' }}>{renderDetail(r)}</div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
