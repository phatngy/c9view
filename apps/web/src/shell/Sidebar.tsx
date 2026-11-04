import { IconButton, Tooltip } from '../kit/index.js';
import { Link } from '@tanstack/react-router';
import {
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  LockKeyhole,
} from 'lucide-react';
import { TopSearch } from '../search/TopSearch.js';
import { useLiveConnection } from '../live/state.js';
import { ProjectNav } from './ProjectNav.js';
import { navLinkClass } from './navLinkClass.js';

export function Sidebar({
  collapsed = false,
  onToggle,
  onNavigate,
  onSearch,
  mobile = false,
  searchInputRef,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  onSearch?: () => void;
  mobile?: boolean;
  searchInputRef?: (input: HTMLInputElement | null) => void;
}) {
  const { state, polling } = useLiveConnection();
  const connectionLabel =
    state === 'live'
      ? 'Live'
      : state === 'connecting'
        ? 'Connecting…'
        : polling
          ? 'Offline · polling'
          : 'Offline';
  const overviewLink = (
    <Link
      to="/"
      activeOptions={{ exact: true }}
      activeProps={{ 'data-current': true }}
      className={navLinkClass}
      aria-label={collapsed ? 'Overview' : undefined}
      onClick={onNavigate}
    >
      <LayoutDashboard size={17} aria-hidden="true" />
      {!collapsed && 'Overview'}
    </Link>
  );
  const searchLink = (
    <Link
      to="/search"
      search={{ q: '', projectId: '', from: '', to: '', model: '' }}
      activeProps={{ 'data-current': true }}
      className={navLinkClass}
      aria-label={collapsed ? 'Search' : undefined}
      onClick={onNavigate}
    >
      <Search size={17} aria-hidden="true" />
      {!collapsed && 'Search'}
    </Link>
  );
  const configLink = (
    <Link
      to="/config"
      activeProps={{ 'data-current': true }}
      className={navLinkClass}
      aria-label={collapsed ? 'Config' : undefined}
      onClick={onNavigate}
    >
      <Settings2 size={17} aria-hidden="true" />
      {!collapsed && 'Config'}
    </Link>
  );
  return (
    <div
      className="shell-sidebar-content flex h-full min-h-0 flex-col gap-5 bg-sidebar px-3 py-4"
      data-collapsed={collapsed || undefined}
    >
      <div className="shell-brand-row flex min-h-8 items-center justify-between px-2">
        {!collapsed && (
          <Link
            to="/"
            className="shell-wordmark flex min-h-11 items-center text-lg font-semibold tracking-[-.01em] text-ink sm:min-h-9"
            onClick={onNavigate}
          >
            c9view<span className="text-accent">.</span>
          </Link>
        )}
        {onToggle && (
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggle}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
          </IconButton>
        )}
      </div>
      <TopSearch
        collapsed={collapsed}
        {...(onSearch ? { onExpand: onSearch } : {})}
        {...(onNavigate ? { onNavigate } : {})}
        shortcuts={!mobile}
        {...(searchInputRef ? { onInputRef: searchInputRef } : {})}
      />
      <nav
        aria-label={mobile ? 'Mobile navigation' : 'Main navigation'}
        className="shell-main-nav flex flex-col gap-[3px]"
      >
        {collapsed ? (
          <Tooltip content="Overview">{overviewLink}</Tooltip>
        ) : (
          overviewLink
        )}
        {collapsed ? (
          <Tooltip content="Search">{searchLink}</Tooltip>
        ) : (
          searchLink
        )}
        {collapsed ? (
          <Tooltip content="Config">{configLink}</Tooltip>
        ) : (
          configLink
        )}
      </nav>
      <nav
        aria-label={mobile ? 'Mobile projects' : 'Projects'}
        className="shell-project-nav min-h-0 flex-1 overflow-auto"
      >
        <ProjectNav
          collapsed={collapsed}
          {...(onNavigate ? { onNavigate } : {})}
        />
      </nav>
      <div className="shell-sidebar-footer flex flex-col gap-2 border-t border-line px-2 pt-3 text-caption text-muted">
        {collapsed ? (
          <Tooltip content={connectionLabel}>
            <span
              tabIndex={collapsed ? 0 : undefined}
              role="status"
              aria-label={connectionLabel}
              className="shell-connection flex items-center gap-2"
            >
              <span className={`shell-live-dot ${state}`} />
              {!collapsed && connectionLabel}
            </span>
          </Tooltip>
        ) : (
          <span
            role="status"
            aria-label={connectionLabel}
            className="shell-connection flex items-center gap-2"
          >
            <span className={`shell-live-dot ${state}`} />
            {connectionLabel}
          </span>
        )}
        {!collapsed && (
          <span className="shell-read-only flex items-center gap-2">
            <LockKeyhole size={12} aria-hidden="true" />
            Read-only workspace
          </span>
        )}
      </div>
    </div>
  );
}
