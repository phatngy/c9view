import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { IconButton } from '../kit/index.js';
import { Menu, X } from 'lucide-react';
import { useRouter } from '@tanstack/react-router';
import { BreadcrumbProvider } from './breadcrumbs.js';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import './shell.css';
function initialCollapsed() {
  try {
    return localStorage.getItem('c9view-sidebar') === 'collapsed';
  } catch {
    return false;
  }
}
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const desktopSearch = useRef<HTMLInputElement>(null);
  const mobileSearch = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    try {
      localStorage.setItem(
        'c9view-sidebar',
        collapsed ? 'collapsed' : 'expanded',
      );
    } catch {
      /* Storage may be disabled. */
    }
  }, [collapsed]);
  useEffect(
    () => router.subscribe('onResolved', () => setOpen(false)),
    [router],
  );
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1024px)');
    if (!media) return;
    const closeOnDesktop = () => {
      if (media.matches) setOpen(false);
    };
    closeOnDesktop();
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, []);
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  const expandSearch = useCallback(() => {
    if (window.matchMedia?.('(max-width: 1023px)').matches) {
      setOpen(true);
      requestAnimationFrame(() => mobileSearch.current?.focus());
    } else {
      setCollapsed(false);
      requestAnimationFrame(() => desktopSearch.current?.focus());
    }
  }, []);
  return (
    <BreadcrumbProvider>
      <div
        className="app-shell min-h-screen bg-page lg:pl-64 lg:data-[sidebar-collapsed]:pl-16"
        data-sidebar-collapsed={collapsed || undefined}
      >
        <aside className="shell-desktop-sidebar fixed inset-y-0 left-0 hidden w-64 border-r border-line lg:block">
          <Sidebar
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
            onSearch={expandSearch}
            searchInputRef={(input) => {
              desktopSearch.current = input;
            }}
          />
        </aside>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <div className="shell-main">
            <TopBar
              menuButton={
                <Dialog.Trigger
                  render={
                    <IconButton
                      className="shell-mobile-trigger"
                      label="Open navigation"
                    >
                      <Menu size={19} aria-hidden="true" />
                    </IconButton>
                  }
                />
              }
            />
            <main className="shell-page-content mx-auto w-full min-w-0 max-w-400 flex-1 px-4 py-5 lg:p-7">
              {children}
            </main>
            <footer className="shell-page-footer px-4 py-4 text-caption text-muted lg:px-7">
              Read-only · Claude Code local workspace
              <p id="api-equivalent-cost" tabIndex={-1} className="mt-1">
                Estimated at API list prices; not your actual bill on a
                subscription plan.
              </p>
            </footer>
          </div>
          <Dialog.Portal>
            <Dialog.Backdrop className="shell-drawer-backdrop fixed inset-0 z-40 bg-black/60" />
            <Dialog.Popup
              initialFocus={() => closeButton.current}
              className="shell-drawer fixed inset-y-0 left-0 z-41 w-[min(288px,90vw)] border-r border-line bg-sidebar outline-none"
            >
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              <Dialog.Description className="sr-only">
                Browse projects and sessions in your local workspace.
              </Dialog.Description>
              <Dialog.Close
                render={
                  <IconButton
                    buttonRef={(button) => {
                      closeButton.current = button;
                    }}
                    className="shell-drawer-close absolute! top-4 right-4 z-1"
                    label="Close navigation"
                  >
                    <X size={18} aria-hidden="true" />
                  </IconButton>
                }
              />
              <Sidebar
                mobile
                onNavigate={() => setOpen(false)}
                searchInputRef={(input) => {
                  mobileSearch.current = input;
                }}
              />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </BreadcrumbProvider>
  );
}
