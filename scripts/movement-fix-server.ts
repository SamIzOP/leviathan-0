/** Isolated development acceptance server; does not change deployment defaults. */
import { createServer } from 'vite';
process.env.PORT = '3003';
process.env.DEV_TOOLS = 'true';
await import('../packages/server/src/dev-entry');
const vite = await createServer({
  root: 'packages/client',
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://localhost:3003', ws: true },
      '/health': 'http://localhost:3003',
    },
  },
});
await vite.listen();
console.log('Movement acceptance: http://localhost:5175');
