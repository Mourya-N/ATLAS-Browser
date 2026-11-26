import React from 'react';

/**
 * Renders structured assistant markdown cleanly without external dependencies or HTML injection.
 * Supports headings, bullet/numbered lists, fenced code blocks, inline code, bold text, and URLs.
 */
export const AgentMessageContent: React.FC<{ content: string }> = ({ content }) => {
  const blocks = splitCodeBlocks(content);

  return (
    <div className="space-y-2 text-[13px] leading-[1.58] text-atlas-text [overflow-wrap:anywhere]">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded-lg border border-atlas-border bg-atlas-shell px-3 py-2 font-mono text-[11.5px] leading-relaxed text-atlas-text"
            >
              <code>{block.text}</code>
            </pre>
          );
        }

        const lines = block.text.split('\n');
        return (
          <div key={idx} className="space-y-1.5">
            {lines.map((line, lineIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return null;

              const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
              if (headingMatch) {
                return (
                  <div
                    key={lineIdx}
                    className="pt-1 text-[13px] font-semibold tracking-[-0.01em] text-atlas-text"
                  >
                    {renderInline(headingMatch[2])}
                  </div>
                );
              }

              const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
              if (bulletMatch) {
                return (
                  <div key={lineIdx} className="flex items-start gap-2 pl-0.5 text-atlas-secondary">
                    <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-atlas-accent" />
                    <span className="min-w-0 flex-1 text-atlas-text">{renderInline(bulletMatch[1])}</span>
                  </div>
                );
              }

              const numMatch = trimmed.match(/^(\d+\.)\s+(.+)$/);
              if (numMatch) {
                return (
                  <div key={lineIdx} className="flex items-start gap-1.5 pl-0.5">
                    <span className="shrink-0 font-mono text-[11.5px] font-medium text-atlas-muted">
                      {numMatch[1]}
                    </span>
                    <span className="min-w-0 flex-1 text-atlas-text">{renderInline(numMatch[2])}</span>
                  </div>
                );
              }

              return (
                <p key={lineIdx} className="text-atlas-text">
                  {renderInline(trimmed)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

function splitCodeBlocks(text: string): Array<{ type: 'text' | 'code'; text: string }> {
  const parts: Array<{ type: 'text' | 'code'; text: string }> = [];
  const regex = /```[\w-]*\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', text: match[1].trimEnd() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', text }];
}

function renderInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g);
  return tokens.map((tok, idx) => {
    if (!tok) return null;
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded border border-atlas-border bg-atlas-shell px-1 py-0.5 font-mono text-[11.5px] text-atlas-text"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-atlas-text">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (/^https?:\/\//i.test(tok)) {
      const cleanUrl = tok.replace(/[.,;:!?]+$/, '');
      const trail = tok.slice(cleanUrl.length);
      return (
        <React.Fragment key={idx}>
          <a
            href={cleanUrl}
            onClick={(e) => {
              e.preventDefault();
              void window.atlas.createTab({ url: cleanUrl, activate: true });
            }}
            className="text-atlas-accent underline decoration-atlas-accent/40 underline-offset-2 hover:decoration-atlas-accent break-all"
            title={`Open ${cleanUrl} in new tab`}
          >
            {cleanUrl}
          </a>
          {trail}
        </React.Fragment>
      );
    }
    return <React.Fragment key={idx}>{tok}</React.Fragment>;
  });
}
