'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { cn } from './cn';
import { THEME_STORAGE_KEY } from './theme-script';

export type ThemePreference = 'light' | 'dark' | 'system';

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);

    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function applyPreference(preference: ThemePreference): void {
  const dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this page.
  }

  applyPreference(preference);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    if (readPreference() === 'system') {
      applyPreference('system');
    }
  };

  media.addEventListener('change', onSystemChange);
  window.addEventListener('storage', listener);

  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', onSystemChange);
    window.removeEventListener('storage', listener);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => 'system');
}

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Segmented light / dark / system control. */
export function ThemeSwitcher({ showLabels = false, className }: { showLabels?: boolean; className?: string }) {
  const preference = useThemePreference();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-subtle p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = preference === value;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setThemePreference(value)}
            className={cn(
              'inline-flex h-7 items-center justify-center gap-1.5 rounded-[5px] px-2 text-xs font-medium transition-colors',
              selected ? 'bg-card text-foreground shadow-xs' : 'text-muted hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {showLabels ? label : null}
          </button>
        );
      })}
    </div>
  );
}
