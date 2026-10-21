import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource-variable/figtree/wght-italic.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import './styles.css';
import { Landing } from './Landing';

// smooth wheel and anchor scrolling. lenis moves the real window scroll, so
// the sticky #how section and every effect that reads window.scrollY keep
// working; with prefers-reduced-motion it leaves scrolling as it is
new Lenis({ autoRaf: true, anchors: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
