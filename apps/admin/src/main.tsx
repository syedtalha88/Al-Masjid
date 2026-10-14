// Must stay the first import (see trusted-types.ts).
import './trusted-types.ts';
import './styles.css';

import { startErrorReporting } from '@mc/ui/observability';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppProviders } from './app/providers.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);

// Sentry only when a DSN was built in (validated by parseClientEnv); loaded lazily after first paint (T0.13).
const dsn: unknown = import.meta.env['VITE_PUBLIC_SENTRY_DSN'];
startErrorReporting({ dsn: typeof dsn === 'string' ? dsn : undefined, app: 'admin' });
