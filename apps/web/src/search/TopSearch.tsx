import { useMachineId } from '../machine.js';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { IconButton, Kbd, Tooltip } from '../kit/index.js';
import { Search } from 'lucide-react';

export function TopSearch({
  collapsed = false,
  onExpand,
  onNavigate,
  shortcuts = true,
  onInputRef,
}: {
  collapsed?: boolean;
  onExpand?: () => void;
  onNavigate?: () => void;
  shortcuts?: boolean;
  onInputRef?: (input: HTMLInputElement | null) => void;
}) {
  const machineId = useMachineId();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!shortcuts) return;
    const focus = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.shiftKey) return;
      const target = event.target;
      const modal =
        target instanceof Element
          ? target.closest('dialog[open], [role="dialog"]')
          : null;
      if (modal && !modal.matches('.shell-drawer')) return;
      const command =
        event.key.toLowerCase() === 'k' &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey;
      const slash =
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !(
          target instanceof Element &&
          target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
          )
        );
      if (!command && !slash) return;
      event.preventDefault();
      onExpand?.();
      input.current?.focus();
    };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, [collapsed, onExpand, shortcuts]);
  if (collapsed)
    return (
      <Tooltip content="Search conversations (⌘K)">
        <IconButton
          label="Search conversations"
          onClick={() => {
            onExpand?.();
            input.current?.focus();
          }}
        >
          <Search size={17} aria-hidden="true" />
        </IconButton>
      </Tooltip>
    );
  return (
    <form
      className="shell-search flex h-10 items-center gap-2 rounded-[9px] border border-line bg-raised px-2.5 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        void navigate({
          to: '/m/$machineId/search',
          params: { machineId },
          search: { q: query, projectId: '', from: '', to: '', model: '' },
        });
        onNavigate?.();
      }}
    >
      <Search className="shrink-0" size={16} aria-hidden="true" />
      <input
        ref={(node) => {
          input.current = node;
          onInputRef?.(node);
        }}
        className="w-full min-w-0 rounded-none border-0 bg-transparent p-0 text-xs shadow-none outline-none"
        aria-label="Search all conversations"
        placeholder="Search or jump to…"
        maxLength={500}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Kbd>/</Kbd>
    </form>
  );
}
