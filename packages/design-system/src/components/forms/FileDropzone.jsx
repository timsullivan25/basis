import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

/** Click-or-drag file picker. Reports File objects; the caller owns the "selected file" state and preview. */
export function FileDropzone({ accept, multiple = false, disabled = false, hint, onFilesSelected, style, ...rest }) {
  const inputRef = React.useRef(null);
  const [dragOver, setDragOver] = React.useState(false);

  function handleFiles(fileList) {
    if (disabled || !fileList || fileList.length === 0) return;
    onFilesSelected && onFilesSelected(Array.from(fileList));
  }

  return (
    <div
      role="button" tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current && inputRef.current.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          inputRef.current && inputRef.current.click();
        }
      }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)',
        padding: 'var(--space-10)', borderRadius: 'var(--radius-md)', textAlign: 'center',
        border: '1px dashed ' + (dragOver ? 'var(--border-focus)' : 'var(--border-default)'),
        background: dragOver ? 'var(--surface-selected)' : 'var(--surface-sunken)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        transition: 'var(--transition-control)', ...style,
      }}
      {...rest}
    >
      <Icon name="upload-cloud" size={22} color="var(--text-tertiary)" />
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
        <strong>Click to upload</strong> or drag and drop
      </span>
      {hint ? <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>{hint}</span> : null}
      <input
        ref={inputRef} type="file" accept={accept} multiple={multiple} disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
