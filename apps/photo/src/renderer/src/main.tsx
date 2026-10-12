import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@auram/ui/global.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
