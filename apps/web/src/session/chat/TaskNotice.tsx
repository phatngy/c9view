import { BellRing } from 'lucide-react';
export function TaskNotice({
  status,
  summary,
}: {
  status: string | null;
  summary: string;
}) {
  return (
    <div
      className={`flex items-start gap-2 text-xs ${status === 'failed' || status === 'killed' ? 'text-danger' : 'text-muted'}`}
    >
      <BellRing aria-hidden="true" size={14} className="shrink-0" />
      <span>{summary}</span>
    </div>
  );
}
