import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../kit/Button.js';
import { Menu } from '../kit/Menu.js';
import { api } from '../api.js';
import { collectExport, exportMarkdown, exportJson } from './export.js';
export function ExportMenu({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const controller = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  async function download(format: 'json' | 'md') {
    const active = new AbortController();
    controller.current = active;
    setRunning(true);
    setCount(0);
    setStatus('');
    try {
      const data = await collectExport(
        (cursor, signal) => api.session(projectId, sessionId, cursor, signal),
        active.signal,
        setCount,
      );
      active.signal.throwIfAborted();
      const content =
        format === 'json'
          ? exportJson(data)
          : exportMarkdown(
              data.session?.title ?? 'Session',
              data.messages,
              data.truncated,
            );
      const url = URL.createObjectURL(
        new Blob(content, {
          type:
            format === 'json'
              ? 'application/json'
              : 'text/markdown;charset=utf-8',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `session-${sessionId}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(
        data.truncated
          ? 'Exported the first 20,000 messages (limit reached).'
          : 'Export complete.',
      );
    } catch (error) {
      setStatus(
        active.signal.aborted
          ? 'Export canceled.'
          : error instanceof Error
            ? error.message
            : 'Export failed.',
      );
    } finally {
      setRunning(false);
      controller.current = null;
    }
  }
  return (
    <div className="contents">
      <Menu
        trigger={
          <Button icon={Download} className="max-sm:min-h-11">
            Export
          </Button>
        }
        items={[
          {
            label: 'Markdown',
            disabled: running,
            onSelect: () => void download('md'),
          },
          {
            label: 'JSON',
            disabled: running,
            onSelect: () => void download('json'),
          },
        ]}
      />
      {running && (
        <p role="status" className="basis-full">
          Exporting {count.toLocaleString()} messages…{' '}
          <Button onClick={() => controller.current?.abort()}>
            Cancel export
          </Button>
        </p>
      )}
      {status && (
        <p role="status" className="basis-full">
          {status}
        </p>
      )}
    </div>
  );
}
