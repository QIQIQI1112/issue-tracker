import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
const application = createRoot(root);
if (import.meta.env.DEV && window.location.pathname === '/__ui/components') {
  void Promise.all([import('./features/preview/ComponentPreview.tsx'), import('./features/preview/preview.css')]).then(([{ ComponentPreview }]) => {
    application.render(<StrictMode><ComponentPreview /></StrictMode>);
  });
} else {
  application.render(<StrictMode><App /></StrictMode>);
}
