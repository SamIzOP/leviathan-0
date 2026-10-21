import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG, decodeClient, encode } from '@leviathan/shared';
import { Game } from './game';
import type { Peer } from './game';
function envNumber(key: string, fallback: number, min = 1, max = 3600000) {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`Invalid ${key}`);
  return n;
}
const game = new Game({
  tickRate: envNumber('TICK_RATE', 60, 10, 120),
  snapshotRate: envNumber('SNAPSHOT_RATE', 30, 1, 60),
  devTools: process.env.DEV_TOOLS === 'true',
  matchMs: envNumber('MATCH_MS', 300000),
  countdownMs: envNumber('COUNTDOWN_MS', 5000),
  voteMs: envNumber('VOTE_MS', 20000),
  reconnectMs: envNumber('RECONNECT_MS', 45000),
  emptyRoomMs: envNumber('EMPTY_ROOM_MS', 60000),
});
const root = resolve(process.env.CLIENT_DIST ?? 'packages/client/dist');
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: true,
          rooms: game.rooms.size,
          tick: game.tick,
          uptime: process.uptime(),
          memory: process.memoryUsage().rss,
        }),
      );
      return;
    }
    const path = resolve(
      root,
      '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname),
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!(await stat(path)).isFile()) throw new Error('not file');
    res.setHeader(
      'Content-Type',
      mime[extname(path)] ?? 'application/octet-stream',
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: CONFIG.maxMessageBytes,
  perMessageDeflate: false,
});
const connections = new Map<
  WebSocket,
  {
    peer: Peer;
    lastPong: number;
    pingSent: number;
    window: number;
    count: number;
    strikes: number;
  }
>();
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        ws.close(1008, 'Origin rejected');
        return;
      }
    } catch {
      ws.close(1008);
      return;
    }
  }
  if (connections.size >= 512) {
    ws.close(1013, 'Capacity');
    return;
  }
  const peer: Peer = {
    id: randomBytes(8).toString('hex'),
    send: (m) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 1024 * 1024) {
          ws.terminate();
          return;
        }
        ws.send(encode(m));
      }
    },
    close: () => ws.close(4001, 'Session replaced'),
  };
  const c = {
    peer,
    lastPong: Date.now(),
    pingSent: 0,
    window: Date.now(),
    count: 0,
    strikes: 0,
  };
  connections.set(ws, c);
  peer.send({
    type: 'hello',
    protocol: CONFIG.protocol,
    tickRate: game.settings.tickRate,
    snapshotRate: game.settings.snapshotRate,
    dev: game.settings.devTools,
    devTools: game.settings.devTools,
  });
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - c.window >= 1000) {
      c.window = now;
      c.count = 0;
    }
    if (++c.count > CONFIG.maxMessagesPerSecond) {
      ws.close(1008, 'Rate limit');
      return;
    }
    const m = decodeClient(data.toString());
    if (!m) {
      if (++c.strikes >= 3) ws.close(1008, 'Malformed messages');
      return;
    }
    if (m.type === 'pong') {
      if (m.time === c.pingSent) {
        c.lastPong = now;
        if (peer.player) peer.player.ping = Math.max(0, now - m.time);
      }
      return;
    }
    game.handle(peer, m);
  });
  ws.on('close', () => {
    game.disconnect(peer);
    connections.delete(ws);
  });
  ws.on('error', () => ws.terminate());
});
// Accumulator avoids setInterval rounding drift (16ms is not a 60Hz clock).
let previous = performance.now(),
  accumulator = 0,
  snapshotAccumulator = 0;
const loop = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(now - previous, 250);
  previous = now;
  const dt = 1000 / game.settings.tickRate;
  while (accumulator >= dt) {
    game.step();
    accumulator -= dt;
    snapshotAccumulator += dt;
    if (snapshotAccumulator >= 1000 / game.settings.snapshotRate) {
      snapshotAccumulator -= 1000 / game.settings.snapshotRate;
      for (const room of game.rooms.values())
        game.broadcast(room, game.snapshot(room));
    }
  }
}, 4);
const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const [ws, c] of connections) {
    if (now - c.lastPong > CONFIG.deadMs) {
      ws.terminate();
      continue;
    }
    c.pingSent = now;
    c.peer.send({ type: 'ping', time: now });
  }
  for (const r of game.rooms.values()) game.update(r);
}, CONFIG.heartbeatMs);
server.listen(envNumber('PORT', 3000, 1, 65535), '0.0.0.0', () =>
  console.log(`LEVIATHAN 0 listening on ${process.env.PORT ?? 3000}`),
);
function shutdown() {
  clearInterval(loop);
  clearInterval(heartbeat);
  for (const ws of connections.keys()) ws.close(1001, 'Server shutting down');
  wss.close();
  server.close();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
