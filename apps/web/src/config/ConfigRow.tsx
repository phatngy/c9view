import { useId, useState } from 'react';
import { Badge, Button } from '../kit/index.js';
import { Markdown } from '../markdown.js';
import type { ConfigRowData } from './sections.js';

export function ConfigRow({ row }: { row: ConfigRowData }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <div className="min-w-0 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">{row.name}</strong>
            <Badge>{row.scope}</Badge>
          </div>
          {!expanded && (
            <p className="mt-1 line-clamp-1 text-xs text-muted">
              {row.description}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 min-w-11 lg:min-h-8"
          aria-label={`More about ${row.name}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Less' : 'More'}
        </Button>
      </div>
      <div id={detailsId} hidden={!expanded} className="mt-2 space-y-2 text-xs">
        <p className="whitespace-pre-wrap text-muted">{row.description}</p>
        {row.path && (
          <p className="break-all font-mono text-small text-muted">
            {row.path}
          </p>
        )}
        {expanded && row.markdown && (
          <Markdown text={row.markdown} demoteHeadings />
        )}
      </div>
    </div>
  );
}
