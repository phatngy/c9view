import { IconButton, Menu } from '../kit/index.js';
import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Theme = 'system' | 'light' | 'dark';
function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem('c9view-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* Storage may be disabled. */
  }
  return 'system';
}
export function ThemeMenu() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media?.addEventListener('change', apply);
    try {
      localStorage.setItem('c9view-theme', theme);
    } catch {
      /* Storage may be disabled. */
    }
    return () => media?.removeEventListener('change', apply);
  }, [theme]);
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;
  return (
    <Menu
      trigger={
        <IconButton label={`Theme: ${theme}. Change theme`}>
          <Icon size={17} aria-hidden="true" />
        </IconButton>
      }
      radioGroup={{
        label: 'Color theme',
        value: theme,
        onValueChange: (value) => {
          if (value === 'system' || value === 'light' || value === 'dark')
            setTheme(value);
        },
        items: [
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
      }}
    />
  );
}
