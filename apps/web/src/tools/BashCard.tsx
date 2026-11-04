import { useId, useState } from 'react';
import { Result, type ToolResult } from './ToolCard.js';
export function BashCard({
  command,
  results,
}: {
  command: string;
  results: ToolResult[];
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const lines = command.split('\n');
  return (
    <>
      <div className="border-t border-line bg-page px-3.5 py-2.5 font-mono text-small">
        <pre
          id={id}
          className="m-0 rounded-none bg-page p-0 whitespace-pre-wrap"
        >
          <span className="text-muted">$ </span>
          <code>
            {lines.length > 5 && !expanded
              ? lines.slice(0, 5).join('\n')
              : command}
          </code>
        </pre>
        {lines.length > 5 && (
          <button
            type="button"
            className="text-muted max-sm:min-h-11"
            aria-controls={id}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Collapse command' : 'Show command'}
          </button>
        )}
      </div>
      {results.map((result, index) => (
        <div key={index} className="border-t border-line text-muted">
          <Result
            result={{
              ...result,
              text: result.text.replace(/^Exit code \d+\r?\n/, ''),
            }}
          />
        </div>
      ))}
    </>
  );
}
