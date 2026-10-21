import { DEFAULT_TUNING, MOVE_LIMITS, TUNING_PRESETS } from '@leviathan/shared';
import type {
  ClientMessage,
  DevState,
  DevTuning,
  RoomView,
} from '@leviathan/shared';
export interface DrawFlags {
  colliders: boolean;
  ghost: boolean;
  raw: boolean;
  velocity: boolean;
  movement: boolean;
  speedGraph: boolean;
}
/** Tuning sliders grouped for the service terminal; every MOVE constant appears once. */
const TUNING_GROUPS: [string, (keyof DevTuning)[]][] = [
  [
    'GROUND',
    [
      'walk',
      'sprint',
      'crouch',
      'groundAccel',
      'sprintAccel',
      'groundDecel',
      'overspeedDecel',
    ],
  ],
  [
    'AIR',
    [
      'gravity',
      'jumpHeight',
      'doubleJump',
      'doubleJumpSteer',
      'airAccel',
      'airSpeed',
      'maxSpeed',
      'coyoteTime',
      'jumpBuffer',
    ],
  ],
  [
    'SLIDE',
    [
      'slideMinStart',
      'slideBase',
      'slideBoost',
      'slideMaxEntry',
      'slideDecel',
      'slideEnd',
      'slideCooldown',
      'slideSteer',
      'slideJumpBoost',
    ],
  ],
  [
    'WALL-RUN',
    [
      'wallRunMinSpeed',
      'wallRunSpeed',
      'wallRunAccel',
      'wallRunMaxAngle',
      'wallRunMinHeight',
      'wallRunReach',
      'wallRunRise',
      'wallRunRiseTime',
      'wallRunGravity',
      'wallRunSink',
      'wallRunTime',
      'wallRunEndSpeed',
      'wallRunLockout',
      'wallJumpAway',
      'wallJumpUp',
    ],
  ],
  [
    'MANTLE',
    [
      'mantleMin',
      'mantleMax',
      'mantleTime',
      'mantleExit',
      'mantleFacing',
      'mantleReach',
    ],
  ],
];
const stepFor = (min: number, max: number) =>
  max - min <= 1.5 ? 0.01 : max - min <= 6 ? 0.05 : max - min <= 40 ? 0.1 : 0.5;
interface Preferences {
  draw: DrawFlags;
  lag: number;
  loss: number;
  sections: Record<string, boolean>;
  timer?: boolean;
  frozen?: boolean;
}
export class DevPanel {
  extend?: () => void;
  root = document.createElement('aside');
  open = false;
  enabled = false;
  state?: DevState;
  preferences: Preferences = {
    draw: {
      colliders: false,
      ghost: false,
      raw: false,
      velocity: false,
      movement: false,
      speedGraph: false,
    },
    lag: 0,
    loss: 0,
    sections: { MATCH: true, PLAYERS: true },
  };
  private rosterKey = '';
  constructor(
    private send: (message: ClientMessage) => void,
    private fault: (lag: number, loss: number) => void,
    private disconnect: (ms: number) => void,
    private close: () => void,
    private sound: () => void = () => {},
  ) {
    this.root.id = 'dev-panel';
    this.root.hidden = true;
    document.body.append(this.root);
    try {
      const saved = JSON.parse(
        localStorage.getItem('devPreferences') ?? 'null',
      ) as Partial<Preferences> | null;
      if (saved)
        this.preferences = {
          ...this.preferences,
          ...saved,
          draw: { ...this.preferences.draw, ...saved.draw },
        };
    } catch {
      /* defaults */
    }
    // A new visit starts uncluttered; the toggle remains available during play.
    this.preferences.draw.colliders = false;
  }
  save() {
    localStorage.setItem('devPreferences', JSON.stringify(this.preferences));
  }
  enable(value: boolean, applyFaults = true) {
    this.enabled = value;
    if (value) {
      this.build();
      if (applyFaults) this.fault(this.preferences.lag, this.preferences.loss);
    } else {
      this.open = false;
      this.root.hidden = true;
      this.state = undefined;
    }
  }
  toggle(open = !this.open) {
    if (!this.enabled) return;
    this.open = open;
    this.root.hidden = !open;
  }
  command(
    action: Extract<ClientMessage, { type: 'dev' }>['action'],
    extra: Partial<Extract<ClientMessage, { type: 'dev' }>> = {},
  ) {
    if (this.enabled) this.send({ type: 'dev', action, ...extra });
  }
  button(label: string, title: string, action: () => void) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.onclick = () => {
      this.sound();
      action();
    };
    return b;
  }
  section(name: string) {
    const d = document.createElement('details');
    d.open = this.preferences.sections[name] ?? false;
    const s = document.createElement('summary');
    s.textContent = name;
    s.title = `Expand or collapse ${name.toLowerCase()} controls.`;
    d.append(s);
    d.ontoggle = () => {
      this.preferences.sections[name] = d.open;
      this.save();
    };
    this.root.append(d);
    return d;
  }
  checkbox(
    parent: HTMLElement,
    label: string,
    title: string,
    key: string,
    initial: boolean,
    change: (value: boolean) => void,
  ) {
    const l = document.createElement('label');
    l.className = 'toggle';
    l.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.dataset.control = key;
    input.onchange = () => change(input.checked);
    l.append(input, document.createTextNode(label));
    parent.append(l);
    return input;
  }
  slider(
    parent: HTMLElement,
    label: string,
    key: string,
    min: number,
    max: number,
    step: number,
    value: number,
    title: string,
    change: (value: number) => void,
  ) {
    const l = document.createElement('label');
    l.title = title;
    const text = document.createElement('span');
    text.textContent = label;
    const output = document.createElement('output');
    output.textContent = String(value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.setAttribute('aria-label', label);
    input.dataset.control = key;
    input.oninput = () => {
      output.textContent = input.value;
      change(Number(input.value));
    };
    l.append(text, output, input);
    parent.append(l);
  }
  build() {
    this.root.replaceChildren();
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'DEV // SERVICE TERMINAL';
    header.append(
      title,
      this.button('×', 'Close panel and capture the mouse.', this.close),
    );
    this.root.append(header);
    const match = this.section('MATCH');
    match.append(
      this.button('END MATCH', 'Finish now and show results.', () =>
        this.command('end'),
      ),
      this.button('RESTART', 'Reset the room and immediately restart.', () =>
        this.command('restart'),
      ),
      this.button('SKIP TO ENDED', 'Open the result and voting screen.', () =>
        this.command('end'),
      ),
      this.button(
        'RETURN TO LOBBY',
        'Stop this test and reopen the lobby.',
        () => this.command('lobby'),
      ),
    );
    this.checkbox(
      match,
      'TIMER ENABLED',
      'Allow the match clock to end the mission.',
      'timer',
      true,
      (v) => {
        this.preferences.timer = v;
        this.save();
        this.command('timer', { enabled: v });
      },
    );
    this.checkbox(
      match,
      'FREEZE TIMER',
      'Hold the current remaining time.',
      'freeze',
      false,
      (v) => {
        this.preferences.frozen = v;
        this.save();
        this.command('freeze', { enabled: v });
      },
    );
    const players = this.section('PLAYERS');
    players.append(
      this.button(
        'ADD BOT PLAYER (+1)',
        'Add one synthetic operator, up to eight total.',
        () => this.command('add-bots', { count: 1 }),
      ),
      this.button(
        'ADD 7 BOTS',
        'Fill available operator slots with up to seven bots.',
        () => this.command('add-bots', { count: 7 }),
      ),
      this.button(
        'REMOVE BOT',
        'Remove the most recently added synthetic operator.',
        () => this.command('remove-bot'),
      ),
    );
    const roster = document.createElement('div');
    roster.id = 'dev-roster';
    players.append(roster);
    const entities = this.section('ENTITIES');
    entities.append(
      this.button(
        'SPAWN DUMMY',
        'Spawn one existing diagnostic capsule at your position.',
        () => this.command('spawn-dummies', { count: 1 }),
      ),
      this.button(
        'SPAWN 10',
        'Spawn ten diagnostic capsules; sixteen maximum.',
        () => this.command('spawn-dummies', { count: 10 }),
      ),
      this.button('CLEAR DUMMIES', 'Remove diagnostic capsules only.', () =>
        this.command('clear-dummies'),
      ),
    );
    const count = document.createElement('p');
    count.id = 'dev-entity-count';
    entities.append(count);
    const network = this.section('NETWORK');
    this.slider(
      network,
      'LATENCY / MS',
      'lag',
      0,
      400,
      10,
      this.preferences.lag,
      'Simulated round-trip gameplay-message latency.',
      (v) => {
        this.preferences.lag = v;
        this.save();
        this.fault(v, this.preferences.loss);
      },
    );
    this.slider(
      network,
      'PACKET LOSS / %',
      'loss',
      0,
      20,
      1,
      this.preferences.loss,
      'Drop a percentage of gameplay messages for testing.',
      (v) => {
        this.preferences.loss = v;
        this.save();
        this.fault(this.preferences.lag, v);
      },
    );
    network.append(
      this.button(
        'FORCE DISCONNECT',
        'Close the socket and use normal reconnect.',
        () => this.disconnect(0),
      ),
      this.button(
        'DISCONNECT 20 SECONDS',
        'Close the socket and defer reconnect for twenty seconds.',
        () => this.disconnect(20000),
      ),
    );
    const player = this.section('PLAYER');
    player.append(
      this.button(
        'TELEPORT TO SPAWN',
        'Move your entity to its original spawn.',
        () => this.command('teleport'),
      ),
      this.button(
        'RESET PLAYER',
        'Reset your entity to its placeholder defaults.',
        () => this.command('reset-player'),
      ),
    );
    const movement = this.section('MOVEMENT TUNING');
    const presets = document.createElement('div');
    presets.className = 'dev-presets';
    for (const name of ['DEFAULT', 'FLOATY', 'HEAVY'] as const)
      presets.append(
        this.button(
          name,
          `Apply the ${name.toLowerCase()} movement preset to this dev room.`,
          () =>
            this.command('tune', {
              tuning: { ...DEFAULT_TUNING, ...TUNING_PRESETS[name] },
            }),
        ),
      );
    presets.append(
      this.button(
        'RESET',
        'Restore every movement constant to its default.',
        () => this.command('reset-tuning'),
      ),
    );
    movement.append(presets);
    const tuning = { ...(this.state?.tuning ?? DEFAULT_TUNING) };
    for (const [group, keys] of TUNING_GROUPS) {
      const heading = document.createElement('h4');
      heading.textContent = group;
      movement.append(heading);
      for (const key of keys) {
        const [min, max] = MOVE_LIMITS[key];
        this.slider(
          movement,
          key.replace(/([A-Z])/g, ' $1').toUpperCase(),
          key,
          min,
          max,
          stepFor(min, max),
          tuning[key],
          'Dev-only room tuning; the server and client prediction step with the same values.',
          (v) => this.command('tune', { tuning: { [key]: v } }),
        );
      }
    }
    const draw = this.section('DEBUG DRAW');
    for (const [key, label] of Object.entries({
      colliders: 'COLLIDER WIREFRAMES',
      ghost: 'AUTHORITATIVE GHOST',
      raw: 'RAW REMOTE POSITIONS',
      velocity: 'VELOCITY VECTORS',
      movement: 'MOVEMENT STATE / PROBES',
      speedGraph: 'SPEED GRAPH (10 S)',
    }))
      this.checkbox(
        draw,
        label,
        'Diagnostic overlay only; does not alter the world.',
        key,
        this.preferences.draw[key as keyof DrawFlags],
        (v) => {
          this.preferences.draw[key as keyof DrawFlags] = v;
          this.save();
        },
      );
    const foot = document.createElement('footer');
    foot.textContent = 'F4 / ` CLOSE · F3 TELEMETRY · H CONTROLS';
    this.root.append(foot);
    this.extend?.();
    this.rosterKey = '';
  }
  update(state: DevState) {
    this.state = state;
    for (const [key, value] of [
      ['timer', state.timerEnabled],
      ['freeze', state.frozen],
    ] as const) {
      const control = this.root.querySelector<HTMLInputElement>(
        `[data-control="${key}"]`,
      );
      if (control) control.checked = value;
    }
    for (const [key, value] of Object.entries(state.tuning)) {
      const control = this.root.querySelector<HTMLInputElement>(
        `[data-control="${key}"]`,
      );
      if (control && document.activeElement !== control) {
        control.value = String(value);
        if (control.previousElementSibling)
          control.previousElementSibling.textContent = String(
            Math.round(value * 100) / 100,
          );
      }
    }
  }
  live(room: RoomView | undefined, entities: number) {
    if (!this.enabled) return;
    const count = this.root.querySelector('#dev-entity-count');
    if (count) count.textContent = `LIVE ENTITIES // ${entities}`;
    const key = JSON.stringify(room?.players);
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      const roster = this.root.querySelector('#dev-roster');
      roster?.replaceChildren();
      for (const p of room?.players ?? []) {
        const row = document.createElement('div');
        row.textContent = `${p.name} / ${p.connected ? 'LINK' : 'LOST'} / ${p.ping} ms`;
        roster?.append(row);
      }
    }
  }
}
