import { defineRoutes } from 'ssr-kit';

export default defineRoutes([
  {
    id: 'root',
    module: () => import('./pages/RootLayout'),
    children: [
      { id: 'home', path: '/', module: () => import('./pages/Home') },
      { id: 'gold', path: 'gold/:id', module: () => import('./pages/GoldDetail') },
      { id: 'old-gold', path: 'old-gold/:id', module: () => import('./pages/OldGold') },
      { id: 'boom', path: 'boom', module: () => import('./pages/Boom') },
      { id: 'about', path: 'about', module: () => import('./pages/About') },
      { id: 'stream', path: 'stream', module: () => import('./pages/Stream') },
      { id: 'external', path: 'external', module: () => import('./pages/External') },
      { id: 'query', path: 'query', module: () => import('./pages/QueryPage') },
      { id: 'admin', path: 'admin', module: () => import('./pages/Admin') },
      { id: 'login', path: 'login', module: () => import('./pages/Login') },
      { id: 'shell', path: 'shell', ssr: false, module: () => import('./pages/Shell') },
    ],
  },
]);
