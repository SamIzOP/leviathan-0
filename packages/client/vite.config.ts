import { defineConfig } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [
    {
      name: 'world-perf-report',
      configureServer(server) {
        server.middlewares.use('/__world-perf', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
            if (body.length > 16384) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const report = JSON.parse(body);
                if (
                  !['LOW', 'MEDIUM', 'HIGH'].includes(report.preset) ||
                  !Number.isFinite(report.averageMs)
                )
                  throw new Error('Invalid report');
                const dir = resolve('../../docs/perf');
                await mkdir(dir, { recursive: true });
                await writeFile(
                  resolve(dir, report.preset.toLowerCase() + '.json'),
                  JSON.stringify(report, null, 2),
                );
                res.statusCode = 204;
                res.end();
              } catch {
                res.statusCode = 400;
                res.end();
              }
            })();
          });
        });
      },
    },
  ],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/health': 'http://localhost:3000',
    },
  },
});
