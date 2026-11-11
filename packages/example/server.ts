import { randomUUID } from 'node:crypto';

import express from 'express';
import { createSsrHandler } from 'ssr-kit/node';

const port = Number(process.env.PORT ?? 3000);
const isProd = process.env.NODE_ENV === 'production';
const getContext = () => ({ requestId: randomUUID() });

const app = express();
app.get('/api/gold-price', (_req, res) => {
  res.json({ pricePerGram: 153_000, at: new Date().toISOString() });
});

if (isProd) {
  app.use('/assets', express.static('dist/client/assets', { immutable: true, maxAge: '1y' }));
  app.use(express.static('dist/client', { index: false }));
  const { build } = await import(new URL('./dist/server/entry.js', import.meta.url).href);
  app.use(createSsrHandler({ build, getContext }));
} else {
  const { createDevServer } = await import('ssr-kit/vite');
  const dev = await createDevServer({ root: import.meta.dirname });
  app.use(dev.middlewares);
  app.use(async (req, res, next) => {
    try {
      await createSsrHandler({ build: await dev.getBuild(), getContext })(req, res, next);
    } catch (error) {
      next(error);
    }
  });
}

app.listen(port, () => {
  console.log(`ssr-kit 예제: http://localhost:${port} (${isProd ? 'production' : 'dev'})`);
});
