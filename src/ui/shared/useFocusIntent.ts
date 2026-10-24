import { useEffect } from 'react';

export function useFocusIntent() {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => { delete root.dataset.focusIntent; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') root.dataset.focusIntent = 'keyboard';
    };
    clear();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, []);
}
