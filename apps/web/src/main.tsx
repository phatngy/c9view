import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './style.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root was not found');
void import('./application.js').then(({ Application }) => {
  createRoot(rootElement).render(
    <StrictMode>
      <Application />
    </StrictMode>,
  );
});
