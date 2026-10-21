import { graphicsControls } from './graphics';
import { movementControls, movementSettings } from './movement-settings';
import { CONFIG, MISSIONS } from '@leviathan/shared';
import type { ClientMessage, DevState, RoomView } from '@leviathan/shared';
export interface UIContext {
  app: HTMLElement;
  room?: RoomView;
  playerId: string;
  dev: boolean;
  devState?: DevState;
  error: string;
  locked: boolean;
  fallback: boolean;
  captureNotice?: boolean;
  dismissCaptureNotice?: () => void;
  suppressPause: boolean;
  devOpen: boolean;
  controlsOpen: boolean;
  sensitivity: number;
  volumes: Record<'master' | 'sfx' | 'music' | 'voice', number>;
  sound: () => void;
  send: (m: ClientMessage) => void;
  solo: (name: string) => void;
  resume: () => void;
  leave: () => void;
  vote: (v: 'REPLAY' | 'NEXT') => void;
  toggleDev: () => void;
  toggleControls: () => void;
  setSensitivity: (v: number) => void;
  setVolume: (bus: 'master' | 'sfx' | 'music' | 'voice', v: number) => void;
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  cls = '',
) {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = cls;
  return node;
}
export function toast(text: string) {
  const target = document.querySelector<HTMLElement>('#toast')!;
  target.textContent = text.toUpperCase();
  target.classList.remove('visible');
  requestAnimationFrame(() => target.classList.add('visible'));
  setTimeout(() => {
    if (target.textContent === text.toUpperCase())
      target.classList.remove('visible');
  }, 4000);
}
export function renderInterface(c: UIContext) {
  const enteredName = c.app.querySelector<HTMLInputElement>('#name')?.value;
  const enteredCode = c.app.querySelector<HTMLInputElement>('#code')?.value;
  const open =
    c.app.querySelector('details.settings')?.hasAttribute('open') ?? false;
  c.app.replaceChildren();
  document.body.dataset.phase = c.room?.phase ?? 'ENTRY';
  const btn = (
    label: string,
    title: string,
    action: () => void,
    cls = 'secondary',
  ) => {
    const b = el('button', label, cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = title;
    b.onclick = () => {
      c.sound();
      action();
    };
    return b;
  };
  const legend = () => {
    const d = el('div', '', 'controls');
    d.append(el('div', 'CONTROLS // KEYBOARD + MOUSE', 'eyebrow'));
    const m = movementSettings;
    const rows = [
      ['W A S D', 'MOVE'],
      ['MOUSE', c.fallback ? 'DRAG TO LOOK' : 'LOOK'],
      ['SPACE', 'JUMP · AIR JUMP · WALL-JUMP'],
      [
        'SHIFT',
        m.sprintMode === 'AUTO' ? 'WALK (AUTO-SPRINT ON)' : 'SPRINT (HOLD)',
      ],
      ['C', m.crouchMode === 'TOGGLE' ? 'CROUCH (TOGGLE)' : 'CROUCH (HOLD)'],
      ...(m.ctrlCrouch ? [['LEFT CTRL', 'CROUCH (CTRL+W RISK)']] : []),
      ['SPRINT + C', 'SLIDE · SPACE TO SLIDE-JUMP'],
      ['JUMP ALONG A WALL', 'WALL-RUN · C DROPS OFF'],
      ['JUMP AT LEDGE', 'MANTLE · C CANCELS'],
      ['ESC', 'PAUSE / RELEASE MOUSE'],
      ['F3', 'TELEMETRY'],
      ['H', 'CONTROLS'],
      ...(c.dev
        ? [
            ['` / F4', 'DEV PANEL'],
            ['F8', 'END MATCH'],
            ['F9', 'DUMMY UNIT'],
          ]
        : []),
    ];
    const list = el('dl');
    for (const [key, value] of rows)
      list.append(el('dt', key), el('dd', value));
    d.append(
      list,
      el(
        'p',
        `SENSITIVITY // ${c.sensitivity.toFixed(4)}`,
        'sensitivity-readout',
      ),
    );
    if (c.captureNotice) {
      const notice = el('aside', '', 'capture-notice');
      notice.append(
        el(
          'p',
          'MOUSE CAPTURE UNAVAILABLE IN THIS BROWSER. OPEN IN CHROME OR EDGE FOR FULL MOUSE LOOK. DRAG TO LOOK IN THE MEANTIME.',
        ),
        btn('DISMISS', 'Dismiss mouse capture notice.', () =>
          c.dismissCaptureNotice?.(),
        ),
      );
      d.append(notice);
    }
    return d;
  };
  const settings = () => {
    const d = el('details', '', 'settings');
    d.open = open;
    d.append(el('summary', 'OPERATOR SETTINGS'));
    const grid = el('div', '', 'settings-grid');
    const header = el('div', '', 'settings-header');
    header.append(
      el('strong', 'OPERATOR SETTINGS'),
      btn(
        '×',
        'Close operator settings.',
        () => {
          d.open = false;
        },
        'settings-close',
      ),
    );
    grid.append(header);
    const slider = (
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      change: (n: number) => void,
    ) => {
      const l = el('label');
      const title = el('span', label);
      const out = el('output', String(value));
      const i = el('input');
      i.type = 'range';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(value);
      i.setAttribute(
        'aria-label',
        label === 'MOUSE SENSITIVITY'
          ? 'Mouse sensitivity'
          : label.toLowerCase(),
      );
      i.title =
        label === 'MOUSE SENSITIVITY'
          ? 'Mouse look sensitivity, saved on this device.'
          : 'Volume level, saved on this device.';
      i.oninput = () => {
        out.textContent = i.value;
        change(Number(i.value));
      };
      l.append(title, out, i);
      grid.append(l);
    };
    slider(
      'MOUSE SENSITIVITY',
      c.sensitivity,
      0.0005,
      0.006,
      0.0001,
      c.setSensitivity,
    );
    for (const bus of ['master', 'sfx', 'music', 'voice'] as const)
      slider(`${bus.toUpperCase()} VOLUME`, c.volumes[bus], 0, 1, 0.01, (v) =>
        c.setVolume(bus, v),
      );
    grid.append(movementControls(), graphicsControls());
    d.append(grid);
    return d;
  };
  const panel = (cls = '') => {
    const p = el('section', '', `slab ${cls}`);
    p.append(
      el('div', 'KAINOS // FIELD OPERATIONS // UNIT 00', 'eyebrow'),
      el('div', `L0–004 / BUILD 0.1 / PROTOCOL ${CONFIG.protocol}`, 'serial'),
    );
    return p;
  };
  const errors = (p: HTMLElement) => {
    if (c.error) {
      const e = el('div', c.error, 'error');
      e.setAttribute('role', 'alert');
      p.append(e);
    }
  };
  const roster = (room: RoomView, results = false) => {
    const table = el('table', '', 'roster');
    table.setAttribute(
      'aria-label',
      results ? 'Mission results' : 'Operator roster',
    );
    const head = el('thead'),
      tr = el('tr');
    for (const h of [
      '#',
      'CALLSIGN',
      results ? 'VOTE' : 'STATUS',
      'PING',
      'ROLE',
    ])
      tr.append(el('th', h));
    head.append(tr);
    const body = el('tbody');
    room.players.forEach((p, i) => {
      const row = el('tr');
      row.append(
        el('td', String(i + 1).padStart(2, '0')),
        el('td', p.name),
        el(
          'td',
          results
            ? (p.vote ?? '—')
            : p.connected
              ? p.ready
                ? 'READY'
                : 'STANDBY'
              : 'LOST',
        ),
      );
      const ping = el('td', `${p.ping}ms`);
      ping.dataset.ping = p.id;
      row.append(ping, el('td', p.id === room.hostId ? 'HOST' : '—'));
      body.append(row);
    });
    table.append(head, body);
    const wrap = el('div', '', 'roster-wrap');
    wrap.append(table);
    return wrap;
  };
  if (c.room?.phase === 'PLAYING') {
    const hud = el('div', '', 'hud');
    hud.append(
      el(
        'span',
        `L0 // ${c.room.levelId === 'movement-lab' ? 'MOVEMENT LAB' : MISSIONS[c.room.mission]}`,
      ),
      el('span', '', 'timer'),
    );
    const shortcuts = el('div', '', 'hud-actions');
    if (c.dev)
      shortcuts.append(
        btn(
          'DEV / F4',
          'Open the development terminal.',
          c.toggleDev,
          'dev-tag',
        ),
      );
    shortcuts.append(
      btn('H / CONTROLS', 'Show all controls.', c.toggleControls),
    );
    hud.append(shortcuts);
    const speedometer = el('div', '', 'speedometer');
    speedometer.hidden = !movementSettings.speedometer;
    speedometer.setAttribute('aria-label', 'Horizontal speed');
    c.app.append(hud, el('div', '+', 'crosshair'), speedometer);
    if (c.fallback && !c.devOpen && !c.controlsOpen)
      c.app.append(
        el(
          'div',
          'MOUSE CAPTURE UNAVAILABLE // WASD TO MOVE · DRAG TO LOOK · ESC TO PAUSE',
          'input-mode',
        ),
      );
    if (c.controlsOpen) {
      const p = panel('controls-overlay');
      p.append(
        el('h2', 'OPERATOR MANUAL'),
        legend(),
        btn(
          'CLOSE / H',
          'Close controls and capture the mouse.',
          c.toggleControls,
          'primary',
        ),
      );
      c.app.append(p);
    } else if (!c.locked && !c.devOpen && !c.suppressPause) {
      const p = panel('paused');
      p.append(
        el('h2', 'UPLINK PAUSED'),
        el('p', 'THE MISSION CONTINUES. YOUR CREW IS STILL MOVING.'),
        btn(
          'CLICK TO RESUME',
          'Capture the mouse and return to the arena.',
          c.resume,
          'primary',
        ),
        legend(),
        settings(),
      );
      c.app.append(p);
    } else if (!c.locked && !c.devOpen)
      c.app.append(
        btn(
          'CLICK TO CAPTURE MOUSE',
          'The browser requires a click to capture your mouse.',
          c.resume,
          'capture-hint',
        ),
      );
    return;
  }
  const p = panel(
    c.room?.phase === 'COUNTDOWN'
      ? 'countdown'
      : c.room
        ? 'room-panel'
        : 'entry',
  );
  if (!c.room) {
    const title = el('h1');
    title.append(el('span', 'LEVIATHAN'), el('b', '0'));
    p.append(
      title,
      el('p', 'THE FACTORIES ARE SILENT.\nTHE MACHINES ARE NOT.', 'flavor'),
    );
    const form = el('form');
    const label = el('label', 'CALLSIGN / OPERATOR ID');
    label.htmlFor = 'name';
    const name = el('input');
    name.id = 'name';
    name.maxLength = 16;
    name.placeholder = 'ENTER CALLSIGN';
    name.value = enteredName ?? localStorage.getItem('name') ?? '';
    name.setAttribute('aria-label', 'Callsign');
    const codeLabel = el('label', 'ROOM ACCESS / FOUR-CHARACTER CODE');
    codeLabel.htmlFor = 'code';
    const code = el('input');
    code.id = 'code';
    code.maxLength = 4;
    code.placeholder = 'CODE';
    code.value =
      enteredCode ??
      new URLSearchParams(location.search).get('room')?.toUpperCase() ??
      '';
    code.setAttribute('aria-label', 'Room code');
    const submit = (type: 'create' | 'join') => {
      localStorage.setItem('name', name.value);
      c.send(
        type === 'create'
          ? { type, protocol: CONFIG.protocol, name: name.value }
          : {
              type,
              protocol: CONFIG.protocol,
              name: name.value,
              code: code.value,
            },
      );
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      c.sound();
      submit('create');
    };
    name.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        c.sound();
        submit('create');
      }
    };
    code.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        c.sound();
        submit('join');
      }
    };
    const create = btn(
      'CREATE ROOM',
      'Establish a new operator room.',
      () => submit('create'),
      'primary',
    );
    const row = el('div', '', 'join-row');
    row.append(
      code,
      btn('JOIN ROOM', 'Join the entered room code.', () => submit('join')),
    );
    form.append(label, name, create, codeLabel, row);
    p.append(form);
    if (c.dev) {
      const dev = el('div', '', 'solo-row');
      dev.append(
        el('span', 'DEV', 'dev-tag'),
        btn(
          'SOLO TEST',
          'Create a solo test as TESTER if no callsign is entered.',
          () => {
            name.value = name.value.trim() || 'TESTER';
            c.solo(name.value);
          },
          'solo-button',
        ),
        el('small', 'INSTANT ENTRY / TIMER OFF'),
      );
      p.append(dev);
    }
    p.append(settings());
  } else if (c.room.phase === 'LOBBY') {
    p.append(el('h2', 'ASSEMBLE / DEPLOY'));
    const codeRow = el('div', '', 'room-code-row');
    codeRow.append(
      el('div', c.room.code, 'code'),
      btn('COPY INVITE LINK', 'Copy a room invitation.', () => {
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('room', c.room!.code);
        void navigator.clipboard
          .writeText(url.toString())
          .then(() => toast('INVITE LINK COPIED'))
          .catch(() => toast(url.toString()));
      }),
    );
    p.append(
      codeRow,
      el(
        'p',
        `${MISSIONS[c.room.mission]} // ${c.room.players.length} OF 8 OPERATORS`,
      ),
      roster(c.room),
    );
    const actions = el('div', '', 'actions');
    const self = c.room.players.find((p) => p.id === c.playerId);
    actions.append(
      btn(
        self?.ready ? 'UNREADY' : 'READY',
        'Toggle your deployment readiness.',
        () => c.send({ type: 'ready', ready: !self?.ready }),
        'primary',
      ),
    );
    if (c.room.hostId === c.playerId)
      actions.append(
        btn('START', 'Start when all operators are ready.', () =>
          c.send({ type: 'start' }),
        ),
      );
    actions.append(btn('LEAVE', 'Release your room slot.', c.leave));
    if (c.dev)
      actions.append(
        btn(
          'DEV / F4',
          'Open development tools, including synthetic players.',
          c.toggleDev,
          'dev-tag',
        ),
      );
    p.append(actions, legend(), settings());
  } else if (c.room.phase === 'COUNTDOWN') {
    p.append(
      el('h2', 'DEPLOYMENT IMMINENT'),
      el('div', '', 'countdown-number timer'),
      el('p', `${MISSIONS[c.room.mission]} // STAND BY FOR UPLINK`),
    );
  } else {
    p.append(el('h2', 'MISSION COMPLETE'));
    const results = el('div', '', 'result-stats');
    results.append(
      el('span', `${c.room.result?.survived ?? 0}s / SURVIVED`),
      el('span', `${c.room.result?.present ?? 0} / PRESENT`),
    );
    p.append(results, roster(c.room, true));
    const votes = el('div', '', 'vote-actions');
    const replays = c.room.players.filter((p) => p.vote === 'REPLAY').length,
      next = c.room.players.filter((p) => p.vote === 'NEXT').length;
    const replay = btn(
      'REPLAY',
      'Vote to replay this factory.',
      () => c.vote('REPLAY'),
      'vote-option',
    );
    replay.append(el('span', String(replays), 'tally'));
    const nextButton = btn(
      'NEXT FACTORY',
      'Vote for the next factory.',
      () => c.vote('NEXT'),
      'vote-option',
    );
    nextButton.append(el('span', String(next), 'tally'));
    const myVote = c.room.players.find((p) => p.id === c.playerId)?.vote;
    replay.setAttribute('aria-pressed', String(myVote === 'REPLAY'));
    nextButton.setAttribute('aria-pressed', String(myVote === 'NEXT'));
    votes.append(replay, nextButton);
    p.append(
      votes,
      el('div', '', 'timer'),
      el('progress', '', 'vote-progress'),
      el('p', 'HOST BREAKS TIES. NO VOTES DEFAULTS TO REPLAY.'),
    );
    if (c.room.hostId === c.playerId)
      p.append(
        btn('OPEN LOBBY', 'Reopen the lobby for new operators.', () =>
          c.send({ type: 'lobby' }),
        ),
      );
    p.append(settings());
  }
  errors(p);
  p.append(el('footer', 'LEVIATHAN 0 // SIGNAL INTEGRITY REQUIRED'));
  c.app.append(p);
  const sceneCaption = el('div', '', 'scene-caption');
  sceneCaption.append(
    el('span', 'EXCLUSION ZONE / 07'),
    el('strong', 'NO SHIFT CHANGE.'),
    el('small', 'ARTIFICIAL PLANET // LEVIATHAN 0'),
  );
  c.app.append(sceneCaption);
}
