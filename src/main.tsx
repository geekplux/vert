import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './page/App';
import { startAnalytics } from './page/analytics';
import './styles/tokens.css';
import './styles/base.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startAnalytics();
