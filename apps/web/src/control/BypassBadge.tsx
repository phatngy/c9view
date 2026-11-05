import { useId } from 'react';
import { Badge } from '../kit/index.js';
import type { BypassBadgeProps, DrivenBadgeProps } from './cards.js';

export function BypassBadge({ compact = false }: BypassBadgeProps) {
  const id = useId();
  return (
    <>
      <Badge
        aria-describedby={id}
        title="Permissions are bypassed on this machine"
        className={`text-danger ${compact ? 'px-1.5! whitespace-nowrap' : ''}`}
      >
        Bypass
      </Badge>
      <span id={id} className="sr-only">
        Permissions are bypassed on this machine.
      </span>
    </>
  );
}

export function DrivenBadge({ compact = false }: DrivenBadgeProps) {
  return (
    <Badge className={compact ? 'px-1.5! whitespace-nowrap' : undefined}>
      Driven by c9view
    </Badge>
  );
}
