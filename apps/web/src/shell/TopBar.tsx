import { Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cx, focusRing, target } from '../kit/classes.js';
import { type Breadcrumb, useShellBreadcrumbs } from './breadcrumbs.js';
import { ThemeMenu } from './ThemeMenu.js';
export function TopBar({ menuButton }: { menuButton: ReactNode }) {
  const items = useShellBreadcrumbs();
  const pathname = useLocation({ select: (location) => location.pathname });
  const breadcrumbs: Breadcrumb[] = items.length
    ? items
    : pathname === '/'
      ? [{ label: 'Overview' }]
      : [];
  const parent = breadcrumbs.findLast((item) => item.to);
  const parentLabel = parent?.textLabel ?? parent?.label;
  const backLabel =
    parentLabel === '…' || parentLabel === '' ? 'project' : parentLabel;
  return (
    // This navigation stays in flow on mobile session pages too.
    <header className="shell-navigation-bar flex h-14 items-center gap-3 border-b border-line bg-page px-4 lg:px-7">
      {menuButton}
      {parent && pathname !== parent.to && (
        <Link
          to={parent.to!}
          activeOptions={{ exact: true }}
          aria-label={`Back to ${backLabel}`}
          data-dense
          className={cx(
            target,
            focusRing,
            'inline-flex w-11 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent px-0 text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-ink lg:w-10',
          )}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </Link>
      )}
      {breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="shell-breadcrumbs min-w-0 flex-1 text-xs text-muted"
        >
          <ol className="m-0 flex list-none items-center gap-2 whitespace-nowrap [overflow-wrap:normal] p-0">
            {breadcrumbs.map((item, index) => (
              <li
                className={`${index < breadcrumbs.length - 1 ? 'hidden sm:flex' : 'flex'} shrink-0 items-center gap-2 last:min-w-0 last:shrink last:overflow-hidden`}
                key={index}
              >
                {index > 0 && (
                  <span className="hidden sm:inline" aria-hidden="true">
                    /
                  </span>
                )}
                {/* Exact matching stops the router marking ancestors current. */}
                {item.to && index < breadcrumbs.length - 1 ? (
                  <Link to={item.to} activeOptions={{ exact: true }}>
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className="truncate text-ink"
                    aria-current={
                      index === breadcrumbs.length - 1 ? 'page' : undefined
                    }
                  >
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="ml-auto">
        <ThemeMenu />
      </div>
    </header>
  );
}
