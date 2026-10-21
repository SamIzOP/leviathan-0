import './style.css';
import {
  CONFIG,
  FLAG,
  reconcile,
  stepPlayer,
  getLevel,
  levelWorld,
  stepDev,
  reconcileDev,
} from '@leviathan/shared';
import type { Entity, Input, RoomView, ServerMessage } from '@leviathan/shared';
import { applyTheme } from './theme';
import { Network } from './network';
import { InputReader } from './input';
import { Renderer } from './renderer';
import { AudioManager } from './audio';
import { MenuBackground } from './menu-background';
import { DevPanel } from './dev-panel';
import { DebugDraw } from './debug-draw';
import { WorldAudio } from './world-audio';
import { worldControls } from './world-controls';
import { renderInterface, toast } from './ui';
applyTheme();
const app = document.querySelector<HTMLDivElement>('#app')!,
  canvas = document.querySelector<HTMLCanvasElement>('#arena')!,
  debug = document.querySelector<HTMLPreElement>('#debug')!;
const audio = new AudioManager(),
  renderer = new Renderer(canvas);
const background = new MenuBackground(),
  debugDraw = new DebugDraw();
let controlsOpen = false,
  soloEntry = new URLSearchParams(location.search).get('solo') === '1',
  everLocked = false,
  soloRequested = false;
let room: RoomView | undefined,
  playerId = '',
  predicted: Entity | undefined,
  pending: Input[] = [],
  seq = 0,
  tick = 0,
  tickRate: number = CONFIG.tickRate,
  snapshotRate: number = CONFIG.snapshotRate,
  dev = false,
  error = '',
  lastPhase = '',
  lastCountdown = -1,
  lastFootstep = 0,
  offline = false;
let predictionError = 0,
  lastSnapshotTick = 0,
  missingSnapshots = 0,
  totalSnapshots = 0,
  snapshotTimes: number[] = [];
let restoreLook = false;
const correction = { x: 0, y: 0, z: 0 };
const input = new InputReader(
  canvas,
  (action) => {
    if (dev) network.send({ type: 'debug', action });
  },
  toggleOverlay,
  () => {
    if (input.active) everLocked = true;
    draw();
  },
);
const network = new Network(receive, (value) => {
  offline = value;
  document.querySelector<HTMLElement>('#reconnecting')!.hidden = !value;
});
const devPanel = new DevPanel(
  (m) => network.send(m),
  (lag, loss) => network.setDevFaults(lag, loss),
  (ms) => network.simulateDisconnect(ms),
  () => toggleOverlay('dev'),
  () => void audio.play('ui_click'),
);
devPanel.extend = () =>
  worldControls(devPanel, renderer, input, () => toggleOverlay('dev'));
let cameraAppliedTo: unknown;
let worldAudio: WorldAudio | undefined;
// Explicit legacy URL fault settings retain precedence over saved dev defaults.
const faultParams = new URLSearchParams(location.search);
const urlFaults = faultParams.has('lag') || faultParams.has('loss');
if (urlFaults) {
  devPanel.preferences.lag = network.lag;
  devPanel.preferences.loss = network.loss;
}
function toggleOverlay(kind: 'dev' | 'controls') {
  if (kind === 'dev') {
    if (!dev) return;
    devPanel.toggle();
    if (devPanel.open) controlsOpen = false;
  } else {
    controlsOpen = !controlsOpen;
    if (controlsOpen) devPanel.toggle(false);
  }
  const open = devPanel.open || controlsOpen;
  if (open) {
    input.pause();
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (room?.phase === 'PLAYING') void input.activate();
  draw();
}
function startSolo(name: string) {
  if (!dev) return;
  soloEntry = true;
  soloRequested = true;
  everLocked = false;
  localStorage.setItem('name', name);
  network.send({
    type: 'dev-solo',
    protocol: CONFIG.protocol,
    name: name.trim() || 'TESTER',
  });
}
function draw() {
  renderInterface({
    app,
    room,
    playerId,
    dev,
    devState: devPanel.state,
    error,
    locked: input.active,
    fallback: input.fallback,
    captureNotice: input.captureUnavailable && !input.noticeDismissed,
    dismissCaptureNotice: () => {
      input.noticeDismissed = true;
      draw();
    },
    suppressPause: soloEntry && !everLocked,
    devOpen: devPanel.open,
    controlsOpen,
    sensitivity: input.sensitivity,
    volumes: audio.volumes,
    sound: () => void audio.play('ui_click'),
    send: (m) => network.send(m),
    solo: startSolo,
    resume: () => {
      if (room?.phase === 'PLAYING' && !devPanel.open && !controlsOpen)
        void input.activate();
    },
    leave: () => {
      input.pause();
      network.send({ type: 'leave' });
      network.clear();
      room = undefined;
      renderer.setLevel();
      worldAudio?.dispose();
      worldAudio = undefined;
      predicted = undefined;
      soloEntry = false;
      draw();
    },
    vote,
    toggleDev: () => toggleOverlay('dev'),
    toggleControls: () => toggleOverlay('controls'),
    setSensitivity: (v) => {
      input.sensitivity = v;
      localStorage.setItem('sensitivity', String(v));
      document
        .querySelectorAll('.sensitivity-readout')
        .forEach((e) => (e.textContent = `SENSITIVITY // ${v.toFixed(4)}`));
    },
    setVolume: (bus, v) => audio.volume(bus, v),
  });
}
function vote(value: 'REPLAY' | 'NEXT') {
  network.send({ type: 'vote', vote: value });
  void audio.play('vote_cast');
}
function setRoom(value: RoomView) {
  const old = room?.phase;
  const comparable = (r: RoomView | undefined) =>
    r
      ? JSON.stringify({
          ...r,
          // The frame loop reads the current deadline. Clock-only updates must
          // not replace a button while the user is pressing it (solo/frozen timers).
          deadline: r.phase === 'PLAYING' ? 0 : r.deadline,
          players: r.players.map((p) => ({ ...p, ping: 0 })),
        })
      : '';
  const changed = comparable(room) !== comparable(value);
  room = value;
  renderer.setLevel(
    value.phase === 'PLAYING' ? (value.levelId ?? 'foundry-row') : undefined,
    value.levelSeed,
  );
  debugDraw.levelId = value.levelId ?? 'foundry-row';
  if (old !== value.phase) {
    pending = [];
    correction.x = correction.y = correction.z = 0;
    if (value.phase === 'PLAYING') {
      void audio.play('match_start');
    } else {
      input.pause();
      worldAudio?.dispose();
      worldAudio = undefined;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (value.phase === 'ENDED') void audio.play('match_end');
  }
  if (changed) draw();
  else if (value.phase === 'LOBBY') {
    value.players.forEach((p) => {
      const status = app.querySelector(`[data-ping="${p.id}"]`);
      if (status) status.textContent = `${p.ping}ms`;
    });
  }
}
function receive(m: ServerMessage) {
  switch (m.type) {
    case 'hello':
      if (m.protocol !== CONFIG.protocol) {
        error = 'Please refresh the page.';
        draw();
        return;
      }
      tickRate = m.tickRate;
      snapshotRate = m.snapshotRate;
      dev = m.devTools;
      network.devAllowed = dev;
      devPanel.enable(dev, !urlFaults);
      draw();
      if (dev && soloEntry && !network.session && !soloRequested)
        startSolo(new URLSearchParams(location.search).get('name') ?? 'TESTER');
      break;
    case 'welcome':
      playerId = m.playerId;
      seq = m.seq;
      pending = [];
      restoreLook = true;
      renderer.snapshots = [];
      lastSnapshotTick = 0;
      totalSnapshots = missingSnapshots = 0;
      snapshotTimes = [];
      network.save({ token: m.token, code: m.room.code });
      setRoom(m.room);
      if (dev && soloEntry && m.room.phase !== 'PLAYING' && !soloRequested)
        startSolo(new URLSearchParams(location.search).get('name') ?? 'TESTER');
      break;
    case 'dev-state':
      if (!dev) break;
      devPanel.update(m.state);
      if (m.state.solo && !soloEntry) {
        soloEntry = true;
        draw();
      }
      if (m.reset) {
        const reset = m.reset.find((r) => r.entity.id === playerId);
        if (reset) {
          predicted = reset.entity;
          pending = pending.filter((i) => i.seq > reset.ack);
          correction.x = correction.y = correction.z = 0;
        }
      }
      break;
    case 'room':
      setRoom(m.room);
      break;
    case 'snapshot': {
      renderer.push(m);
      tick = m.tick;
      const now = performance.now();
      snapshotTimes.push(now);
      snapshotTimes = snapshotTimes.filter((t) => now - t < 2000);
      if (lastSnapshotTick) {
        const expected = tickRate / snapshotRate;
        missingSnapshots += Math.max(
          0,
          Math.round((m.tick - lastSnapshotTick) / expected) - 1,
        );
      }
      lastSnapshotTick = m.tick;
      totalSnapshots++;
      const authoritative = m.entities.find((e) => e.id === playerId);
      if (authoritative) {
        if (restoreLook) {
          input.yaw = authoritative.yaw;
          input.pitch = authoritative.pitch;
          restoreLook = false;
        }
        const result =
          dev && devPanel.state
            ? reconcileDev(
                authoritative,
                m.acks[playerId] ?? 0,
                pending,
                1 / tickRate,
                levelWorld(getLevel(room?.levelId)),
                devPanel.state.tuning,
              )
            : reconcile(
                authoritative,
                m.acks[playerId] ?? 0,
                pending,
                1 / tickRate,
                levelWorld(getLevel(room?.levelId)),
              );
        if (predicted && room?.phase === 'PLAYING') {
          predictionError = Math.hypot(
            predicted.position.x - result.state.position.x,
            predicted.position.y - result.state.position.y,
            predicted.position.z - result.state.position.z,
          );
          for (const axis of ['x', 'y', 'z'] as const)
            correction[axis] +=
              predicted.position[axis] - result.state.position[axis];
        }
        predicted = result.state;
        pending = result.pending;
      }
      break;
    }
    case 'error':
      error = m.message;
      if (m.code === 'SESSION_EXPIRED') {
        room = undefined;
        predicted = undefined;
        if (dev && soloEntry && !soloRequested)
          startSolo(
            new URLSearchParams(location.search).get('name') ??
              localStorage.getItem('name') ??
              'TESTER',
          );
      }
      draw();
      toast(m.message);
      break;
    case 'replaced':
      input.pause();
      worldAudio?.dispose();
      worldAudio = undefined;
      if (document.pointerLockElement) document.exitPointerLock();
      room = undefined;
      renderer.setLevel();
      predicted = undefined;
      error =
        'This uplink was replaced by another tab. Close this tab or reload to reconnect.';
      draw();
      break;
    case 'event':
      toast(`${m.name} · ${m.event}`);
      void audio.play(
        m.event === 'join' || m.event === 'reconnect'
          ? 'player_join'
          : 'player_leave',
      );
      break;
  }
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) everLocked = true;
  draw();
});
let previous = performance.now(),
  accumulator = 0;
let previousSimulation = performance.now();
// Networking/prediction must not slow down when rendering is expensive or throttled.
setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(now - previousSimulation, 250);
  previousSimulation = now;
  while (accumulator >= 1000 / tickRate) {
    accumulator -= 1000 / tickRate;
    if (
      room?.phase === 'PLAYING' &&
      predicted &&
      !offline &&
      !network.replaced
    ) {
      if (pending.length >= CONFIG.maxPending) {
        pending = [];
        toast('Uplink delayed. Resynchronizing.');
      }
      const command = input.command(++seq, tick + pending.length + 1);
      if (dev && renderer.world && renderer.world.mode !== 'player') {
        command.x = 0;
        command.z = 0;
        command.buttons = 0;
        command.yaw = predicted.yaw;
        command.pitch = predicted.pitch;
      }
      pending.push(command);
      const before = predicted;
      predicted =
        dev && devPanel.state
          ? stepDev(
              predicted,
              command,
              1 / tickRate,
              levelWorld(getLevel(room?.levelId)),
              devPanel.state.tuning,
            )
          : stepPlayer(
              predicted,
              command,
              1 / tickRate,
              levelWorld(getLevel(room?.levelId)),
            );
      network.send({ type: 'inputs', inputs: pending.slice(-CONFIG.maxBatch) });
      if (command.buttons & 1 && before.flags & FLAG.grounded)
        void audio.play('jump', { position: predicted.position });
      if (
        (command.x || command.z) &&
        predicted.flags & FLAG.grounded &&
        now - lastFootstep > 350
      ) {
        lastFootstep = now;
        worldAudio?.footstep(predicted.position);
      }
    }
  }
}, 4);
function frame(now: number) {
  const elapsed = Math.min(now - previous, 250);
  previous = now;
  if (predicted && (!renderer.world || renderer.world.mode === 'player')) {
    predicted.yaw = input.yaw;
    predicted.pitch = input.pitch;
    audio.listener(predicted.position, input.yaw);
  }
  const decay = Math.exp(-elapsed / 75);
  correction.x *= decay;
  correction.y *= decay;
  correction.z *= decay;
  if (room?.phase === 'PLAYING') {
    background.stop();
    if (dev && renderer.world?.ready && cameraAppliedTo !== renderer.world) {
      cameraAppliedTo = renderer.world;
      const params = new URLSearchParams(location.search),
        mode = params.get('perf') === '1' ? 'perf' : params.get('camera');
      if (mode) renderer.world.cameraView(mode, renderer.camera);
    }
    if (renderer.world?.ready && !worldAudio)
      worldAudio = new WorldAudio(audio, renderer.world.level);
    if (predicted) worldAudio?.update(predicted.position);
    renderer.world?.control(input, renderer.camera, elapsed);
    renderer.render(
      room?.phase === 'PLAYING' ? predicted : undefined,
      playerId,
      new Map(room?.players.map((p) => [p.id, p.name]) ?? []),
      correction,
    );
    debugDraw.render(
      renderer.camera,
      renderer.snapshots.at(-1)?.entities ?? [],
      playerId,
      devPanel.preferences.draw,
      dev,
      predicted,
    );
  } else {
    background.start();
    debugDraw.canvas.hidden = true;
  }
  devPanel.live(room, renderer.snapshots.at(-1)?.entities.length ?? 0);
  if (room) {
    const remaining = Math.max(
      0,
      Math.ceil((room.deadline - Date.now() + renderer.offset) / 1000),
    );
    const timer = app.querySelector('.timer');
    if (timer)
      timer.textContent =
        room.phase === 'PLAYING' &&
        devPanel.state &&
        !devPanel.state.timerEnabled
          ? 'TIMER // DISABLED'
          : room.phase === 'PLAYING' && devPanel.state?.frozen
            ? 'TIMER // FROZEN'
            : room.phase === 'COUNTDOWN'
              ? String(remaining)
              : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    if (
      room.phase === 'COUNTDOWN' &&
      (lastCountdown !== remaining || lastPhase !== room.phase)
    ) {
      lastCountdown = remaining;
      if (timer) {
        timer.classList.remove('flash');
        void timer.getBoundingClientRect();
        timer.classList.add('flash');
      }
      void audio.play('countdown_tick');
    }
    lastPhase = room.phase;
    const progress = app.querySelector<HTMLProgressElement>('.vote-progress');
    if (progress) {
      progress.max = CONFIG.voteMs;
      progress.value = Math.max(
        0,
        room.deadline - Date.now() + renderer.offset,
      );
    }
  }
  debug.hidden = !input.debug;
  debug.textContent = `SERVER TICK ${tick}\nSNAPSHOTS ${(snapshotTimes.length / 2).toFixed(1)} / ${snapshotRate} Hz\nPING ${room?.players.find((p) => p.id === playerId)?.ping ?? 0} ms\nLOSS EST. ${((100 * missingSnapshots) / Math.max(1, totalSnapshots + missingSnapshots)).toFixed(1)}%\nPREDICTION ERROR ${predictionError.toFixed(4)} m\nUNACKNOWLEDGED ${pending.length}\nENTITIES ${renderer.snapshots.at(-1)?.entities.length ?? 0}`;
  requestAnimationFrame(frame);
}
// Read-only diagnostics used by the browser acceptance harness and future netcode tools.
Object.defineProperty(window, 'leviathan', {
  get: () => ({
    room,
    playerId,
    predicted,
    pending: pending.length,
    predictionError,
    tick,
    snapshotHz: snapshotTimes.length / 2,
    entities: renderer.snapshots.at(-1)?.entities,
    rendered: [...renderer.avatars].map(([id, a]) => ({
      id,
      position: a.group.position.toArray(),
    })),
    audio: {
      events: audio.events,
      assets: audio.assetsPlayed,
      fallbacks: audio.fallbacksPlayed,
    },
    session: network.session ? { code: network.session.code } : null,
    devTools: dev,
    devState: devPanel.state,
    devPanelOpen: devPanel.open,
    background: background.stats,
    world: renderer.world?.stats(),
    environmentAudio: {
      initialized: worldAudio?.initialized,
      interior: worldAudio?.interior,
      nodes: worldAudio?.nodes.length,
      filterHz: worldAudio?.filter?.frequency.value,
    },
    perf: renderer.world?.perfReport,
    worldDebug: dev
      ? {
          camera: (name: string) => {
            if (
              name === 'player' ||
              name === 'free' ||
              name === 'perf' ||
              renderer.world?.level.cameras[name]
            )
              renderer.world?.cameraView(name, renderer.camera);
          },
        }
      : undefined,
  }),
});
draw();
network.connect();
requestAnimationFrame(frame);
