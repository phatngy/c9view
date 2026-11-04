export function cx(...values: (string | undefined | false)[]) {
  return values.filter(Boolean).join(' ');
}
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
export const target = 'min-h-11 min-w-11 lg:min-h-9 lg:min-w-9';
export const popup =
  'z-50 rounded-lg border border-line-strong bg-raised p-1 text-sm text-ink shadow-lg';
export const option =
  'flex min-h-11 items-center gap-2 rounded px-3 outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent data-[disabled]:opacity-40 lg:min-h-9';
