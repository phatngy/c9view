import type { ReactNode } from 'react';
import { shortTime } from './time.js';
export function UserBubble({
  children,
  timestamp,
}: {
  children: ReactNode;
  timestamp: string | null;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="bubble flex max-w-[78%] min-w-0 flex-col gap-2.5 rounded-[16px_16px_4px_16px] bg-bubble px-4 py-3 text-ink">
        {children}
      </div>
      <div className="text-xs text-muted">
        You
        {timestamp && (
          <>
            {' '}
            · <time dateTime={timestamp}>{shortTime(timestamp)}</time>
          </>
        )}
      </div>
    </div>
  );
}
