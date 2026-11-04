import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Badge } from '../../kit/Badge.js';
export function SystemNote({
  children,
  meta = false,
}: {
  children: ReactNode;
  meta?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted">
      <Info aria-hidden="true" size={14} className="shrink-0" />
      <div className="min-w-0 space-y-2">
        {meta && <Badge>system</Badge>}
        {children}
      </div>
    </div>
  );
}
