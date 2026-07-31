'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'wakhanza-theme';
const listeners = new Set<() => void>();

function subscribeDark(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getDarkSnapshot() {
  return document.documentElement.classList.contains('dark');
}

function getDarkServerSnapshot() {
  return false;
}

function noopSubscribe() {
  return () => {};
}

function setDark(next: boolean) {
  document.documentElement.classList.toggle('dark', next);
  localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
  listeners.forEach((listener) => listener());
}

export function ThemeToggle() {
  // Bootstrap script di root layout sudah menentukan class 'dark' sebelum
  // hydration -- useSyncExternalStore membaca DOM/localStorage (state di
  // luar React) dengan aman tanpa memicu mismatch server/client.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const isDark = useSyncExternalStore(subscribeDark, getDarkSnapshot, getDarkServerSnapshot);

  return (
    <button
      type="button"
      onClick={() => setDark(!isDark)}
      disabled={!mounted}
      aria-label={mounted ? (isDark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap') : 'Ganti tema'}
      title={mounted ? (isDark ? 'Tema gelap aktif' : 'Tema terang aktif') : undefined}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-0"
    >
      {mounted && (isDark ? <SunIcon /> : <MoonIcon />)}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  );
}
