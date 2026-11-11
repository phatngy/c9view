import { useRef, useState } from 'react';
import type {
  DecisionBody,
  PermissionRequest,
  QuestionRequest,
  TrustSummary,
} from '@c9view/api';

export type Decision = Omit<DecisionBody, 'clientRequestId'>;
export interface PermissionCardProps {
  request: PermissionRequest;
  onDecide: (d: Decision) => Promise<void>;
}
export interface QuestionCardProps {
  request: QuestionRequest;
  onDecide: (d: Decision) => Promise<void>;
}
export interface TrustCardProps {
  trust: TrustSummary;
  onTrust: () => Promise<void>;
  onCancel: () => void;
  changed?: boolean;
}
export interface BypassBadgeProps {
  compact?: boolean;
}
export interface DrivenBadgeProps {
  compact?: boolean;
}

/** Keep the synchronous guard separate from React's scheduled state updates. */
export function useCardAction() {
  const locked = useRef(false);
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle');
  const [error, setError] = useState<string>();
  async function submit(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setState('pending');
    setError(undefined);
    try {
      await action();
      setState('done');
    } catch (cause) {
      locked.current = false;
      setState('idle');
      setError(
        cause instanceof Error
          ? cause.message
          : 'Request failed. Please try again.',
      );
    }
  }
  return {
    submit,
    error,
    disabled: state !== 'idle',
    pending: state === 'pending',
    done: state === 'done',
  };
}

export { PermissionCard } from './PermissionCard.js';
export { QuestionCard } from './QuestionCard.js';
export { TrustCard } from './TrustCard.js';
export { BypassBadge, DrivenBadge } from './BypassBadge.js';
