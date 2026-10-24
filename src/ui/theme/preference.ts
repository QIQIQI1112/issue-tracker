export function initializeTheme() {
  document.documentElement.dataset.theme = 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#fcfcfb');
}
