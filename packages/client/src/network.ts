import { CONFIG, decodeServer, encode } from '@leviathan/shared';
import type { ClientMessage, ServerMessage } from '@leviathan/shared';
export interface Session {
  token: string;
  code: string;
}
export class Network {
  ws?: WebSocket;
  session: Session | null = null;
  replaced = false;
  retry = 0;
  generation = 0;
  timer?: ReturnType<typeof setTimeout>;
  lag: number;
  loss: number;
  /** Extra one-way delay, uniform 0..jitter ms per message, order preserved. */
  jitter = 0;
  private sendAt = 0;
  private receiveAt = 0;
  queuedJoin?: ClientMessage;
  devAllowed = false;
  private blockedUntil = 0;
  simulateDisconnect(ms: number) {
    if (!this.devAllowed) return;
    this.blockedUntil = Date.now() + ms;
    this.status(!!this.session);
    this.ws?.close();
  }
  setDevFaults(lag: number, loss: number, jitter = this.jitter) {
    if (!this.devAllowed) return;
    this.lag = Math.max(0, Math.min(400, lag));
    this.loss = Math.max(0, Math.min(20, loss));
    this.jitter = Math.max(0, Math.min(100, jitter));
  }
  /** Half the round-trip lag plus jitter, never earlier than the previous message
   * in the same direction (a WebSocket is ordered). */
  private delay(direction: 'send' | 'receive') {
    const now = performance.now(),
      wanted = now + this.lag / 2 + Math.random() * this.jitter,
      at = Math.max(
        wanted,
        direction === 'send' ? this.sendAt : this.receiveAt,
      );
    if (direction === 'send') this.sendAt = at;
    else this.receiveAt = at;
    return at - now;
  }
  constructor(
    public receive: (m: ServerMessage) => void,
    public status: (offline: boolean) => void,
  ) {
    const params = new URLSearchParams(location.search);
    this.lag = Math.max(0, Math.min(2000, Number(params.get('lag')) || 0));
    this.loss = Math.max(0, Math.min(50, Number(params.get('loss')) || 0));
    try {
      this.session = JSON.parse(
        sessionStorage.getItem('session') ??
          localStorage.getItem('session') ??
          'null',
      ) as Session | null;
    } catch {
      this.clear();
    }
  }
  save(session: Session) {
    this.session = session;
    sessionStorage.setItem('session', JSON.stringify(session));
    localStorage.setItem('session', JSON.stringify(session));
  }
  clear() {
    this.session = null;
    sessionStorage.removeItem('session');
    localStorage.removeItem('session');
  }
  connect() {
    if (this.devAllowed && Date.now() < this.blockedUntil) {
      this.timer = setTimeout(
        () => this.connect(),
        this.blockedUntil - Date.now(),
      );
      return;
    }
    const gen = ++this.generation;
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
    );
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (this.session)
        this.send({
          type: 'resume',
          protocol: CONFIG.protocol,
          ...this.session,
        });
      else {
        this.status(false);
        if (this.queuedJoin) {
          const request = this.queuedJoin;
          this.queuedJoin = undefined;
          this.send(request);
        }
      }
    };
    ws.onmessage = (e) => {
      const m = decodeServer(String(e.data));
      if (m.type === 'ping') {
        this.send({ type: 'pong', time: m.time });
        return;
      }
      if (m.type === 'replaced') {
        this.replaced = true;
        this.status(false);
      }
      if (m.type === 'welcome') this.status(false);
      if (m.type === 'error' && m.code === 'SESSION_EXPIRED') {
        this.clear();
        this.status(false);
      }
      if (m.type === 'snapshot' && Math.random() * 100 < this.loss) return;
      setTimeout(
        () => {
          if (this.generation === gen) this.receive(m);
        },
        m.type === 'snapshot' ? this.delay('receive') : 0,
      );
    };
    ws.onclose = () => {
      if (this.replaced) return;
      this.status(!!this.session);
      this.timer = setTimeout(
        () => this.connect(),
        Math.min(5000, 250 * 2 ** this.retry++),
      );
    };
  }
  send(message: ClientMessage) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (message.type === 'create' || message.type === 'join')
        this.queuedJoin = message;
      return;
    }
    if (message.type === 'inputs' && Math.random() * 100 < this.loss) return;
    const wire = encode(message);
    setTimeout(
      () => {
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) ws.send(wire);
      },
      message.type === 'inputs' ? this.delay('send') : 0,
    );
  }
}
