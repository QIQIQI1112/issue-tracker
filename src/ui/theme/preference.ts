export type Theme = 'light' | 'dark';

export function currentTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111111' : '#fcfcfb');
}

export function initializeTheme() {
  let theme: Theme = 'light';
  try {
    if (window.localStorage.getItem('loop.theme') === 'dark') theme = 'dark';
  } catch {
    theme = 'light';
  }
  applyTheme(theme);
}

export function selectTheme(theme: Theme) {
  applyTheme(theme);
  try {
    window.localStorage.setItem('loop.theme', theme);
  } catch {
    return;
  }
}
