import React from 'react';
import { DynamicIcon, dynamicIconImports } from 'lucide-react/dynamic';

const fallbackGlyph = () => <span style={{ display: 'inline-block' }} />;

/** Lucide glyph, code-split and loaded on demand per icon name. */
export function Icon({ name = 'circle', size = 14, color = 'currentColor', strokeWidth = 2, style, title, ...rest }) {
  const iconName = dynamicIconImports[name] ? name : 'circle';
  return (
    <DynamicIcon
      name={iconName}
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      role="img"
      aria-label={title || name}
      fallback={fallbackGlyph}
      style={{ display: 'inline-block', flex: '0 0 auto', verticalAlign: '-0.15em', ...style }}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
    </DynamicIcon>
  );
}
