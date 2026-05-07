import React from 'react';

export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      return <strong key={i} className="font-semibold text-gray-900">{boldMatch[1]}</strong>;
    }
    const italicParts = part.split(/(\*[^*]+\*)/g);
    if (italicParts.length === 1) return <React.Fragment key={i}>{part}</React.Fragment>;
    return (
      <React.Fragment key={i}>
        {italicParts.map((ip, j) => {
          const italicMatch = ip.match(/^\*(.+)\*$/);
          if (italicMatch) return <em key={j}>{italicMatch[1]}</em>;
          return <React.Fragment key={j}>{ip}</React.Fragment>;
        })}
      </React.Fragment>
    );
  });
}

export function stripMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
}
