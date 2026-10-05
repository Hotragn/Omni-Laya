import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './local.css';
import { About } from './about';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <About />
  </StrictMode>
);
