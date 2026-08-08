import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import App from './App';
import { loadRuntimeConfig } from './config/runtimeConfig';
import './index.css';

async function bootstrap(): Promise<void> {
  await loadRuntimeConfig();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

bootstrap().catch((error: unknown) => {
  console.error('Application configuration failed to load.', error);
  const root = document.getElementById('root');
  if (root) {
    root.textContent =
      'Application configuration is unavailable. Please try again later.';
  }
});
