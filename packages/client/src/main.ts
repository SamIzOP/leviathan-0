import './style.css';
import {
  CONFIG,
  DEFAULT_RULES,
  DEV_LEVELS,
  FIRE_BUTTON,
  STATUS,
  combatMatches,
  combatRules,
  getLevel,
  levelWorld,
  predictionMatches,
  resolveTuning,
  stepCombatant,
} from '@leviathan/shared';
import type {
  CombatRules,
  CombatStep,
  DevState,
  Entity,
  Input,
  MoveMode,
  RoomView,
  ServerMessage,
} from '@leviathan/shared';
import { CombatClient } from './combat';
import { adsLookScale } from './weapon-settings';
import { graphics } from './graphics';
import { applyTheme } from './theme';
import { Network } from './network';
import { InputReader, type InjectedInput } from './input';
import { InputDiagnostics } from './input-diagnostics';
import { interpolatePosition } from './look-pipeline';
import type { WallLatchDiagnostic } from '../../shared/src/movement';
import { Renderer } from './renderer';
import { AudioManager } from './audio';
import { MenuBackground } from './menu-background';
import { DevPanel } from './dev-panel';
import { DebugDraw } from './debug-draw';
import { WorldAudio } from './world-audio';
import { MovementAudio } from './movement-audio';
import { movementSettings } from './movement-settings';
import { worldControls } from './world-controls';
import { renderInterface, toast } from './ui';
applyTheme();
const app = document.querySelector<HTMLDivElement>('#app')!,
  canvas = document.querySelector<HTMLCanvasElement>('#arena')!,
  debug = document.querySelector<HTMLPreElement>('#debug')!;
const audio = new AudioManager(),
  renderer = new Renderer(canvas);
const combat = new CombatClient(renderer.scene, audio);
renderer.overlay = (r) => combat.overlay(r);
const background = new MenuBackground(),
  debugDraw = new DebugDraw();
const urlParams = new URLSearchParams(location.search);
// Dev-only test level for a solo entry (/?solo=1&level=lab).
const soloLevel = urlParams.get('level') === 'lab' ? 'lab' : undefined;
let controlsOpen = false,
  soloEntry = urlParams.get('solo') === '1',
  everLocked = false,
  soloRequested = false,
  levelRequested = false;
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
// Predicted state after each command, for exact mismatch detection on acknowledgement.
let history = new Map<number, Entity>();
let reconciliations = 0,
  matchedSnapshots = 0,
  maxPredictionError = 0;
const reached = new Set<MoveMode>();
const playerNames = new Map<string, string>();
let restoreLook = false;
const correction = { x: 0, y: 0, z: 0 };
let previousPosition: Entity['position'] | undefined;
const renderPosition = { x: 0, y: 0, z: 0 };
let wallDiagnostic: WallLatchDiagnostic | undefined;
const inputDiagnostics = import.meta.env.DEV
  ? new InputDiagnostics()
  : undefined;
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
input.onMouse = (x, y) => inputDiagnostics?.mouse(x, y);
const devPanel = new DevPanel(
  (m) => network.send(m),
  (lag, loss, jitter) => network.setDevFaults(lag, loss, jitter),
  (ms) => network.simulateDisconnect(ms),
  () => toggleOverlay('dev'),
  () => void audio.play('ui_click'),
);
devPanel.extend = () =>
  worldControls(devPanel, renderer, input, () => toggleOverlay('dev'));
let cameraAppliedTo: unknown;
let worldAudio: WorldAudio | undefined;
let movementAudio: MovementAudio | undefined;
// Explicit legacy URL fault settings retain precedence over saved dev defaults.
const urlFaults = urlParams.has('lag') || urlParams.has('loss');
if (urlFaults) {
  devPanel.preferences.lag = network.lag;
  devPanel.preferences.loss = network.loss;
}
const world = () => levelWorld(getLevel(room?.levelId));
let rulesFor: DevState | undefined,
  rulesCache: CombatRules = DEFAULT_RULES;
/** Weapon rules: data plus a dev room's live overrides and infinite-ammo toggle,
 * exactly what the server steps with. */
function rules(): CombatRules {
  const state = dev ? devPanel.state : undefined;
  if (state !== rulesFor) {
    rulesFor = state;
    rulesCache = state?.combat
      ? combatRules(state.combat.weapons, state.combat.infiniteAmmo)
      : DEFAULT_RULES;
  }
  return rulesCache;
}
/** The one shared step (movement unchanged inside it), with the room's dev tuning
 * when present. */
function step(state: Entity, command: Input): CombatStep {
  return stepCombatant(
    state,
    command,
    1 / tickRate,
    world(),
    dev && devPanel.state ? resolveTuning(devPanel.state.tuning) : undefined,
    rules(),
    dev
      ? (sample) => {
          wallDiagnostic = sample;
        }
      : undefined,
  );
}
const dead = (e?: Entity) => !!((e?.status ?? 0) & STATUS.dead);
let authoritativeLocal: Entity | undefined;
let lastLook = { yaw: 0, pitch: 0 };
let hitDebugRequested = false;
let lastMismatch = '';
/** Predicted shots per movement state (dev acceptance: firing in every state). */
const shotsByMode: Partial<Record<MoveMode | 'SPRINT', number>> = {};
let shotsFired = 0,
  hitsConfirmed = 0,
  sprintPull = false;
const rewinds: {
  requested: number;
  applied: number;
  x?: number;
  z?: number;
  view?: number;
}[] = [];
function resetPrediction() {
  previousPosition = undefined;
  pending = [];
  history = new Map();
  correction.x = correction.y = correction.z = 0;
}
function disposeAudio() {
  worldAudio?.dispose();
  worldAudio = undefined;
  movementAudio?.dispose();
  movementAudio = undefined;
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
    ...(soloLevel ? { level: soloLevel } : {}),
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
      disposeAudio();
      predicted = undefined;
      combat.reset();
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
  playerNames.clear();
  for (const player of value.players) playerNames.set(player.id, player.name);
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
  const levelChanged = room?.levelId !== value.levelId;
  room = value;
  renderer.setLevel(
    value.phase === 'PLAYING' ? (value.levelId ?? 'foundry-row') : undefined,
    value.levelSeed,
  );
  debugDraw.levelId = value.levelId ?? 'foundry-row';
  if (levelChanged) disposeAudio();
  if (old !== value.phase) {
    resetPrediction();
    if (value.phase === 'PLAYING') {
      void audio.play('match_start');
    } else {
      input.pause();
      disposeAudio();
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
/** A solo URL decides the level: ?level=lab enters the lab; plain ?solo=1 leaves it. */
function wantsLevel(r: RoomView) {
  const mismatch = soloLevel
    ? r.levelId !== DEV_LEVELS[soloLevel]
    : r.levelId === DEV_LEVELS.lab;
  return (
    dev &&
    soloEntry &&
    urlParams.get('solo') === '1' &&
    mismatch &&
    !levelRequested &&
    r.hostId === playerId
  );
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
        startSolo(urlParams.get('name') ?? 'TESTER');
      break;
    case 'welcome':
      playerId = m.playerId;
      seq = m.seq;
      resetPrediction();
      restoreLook = true;
      renderer.snapshots = [];
      lastSnapshotTick = 0;
      totalSnapshots = missingSnapshots = 0;
      snapshotTimes = [];
      network.save({ token: m.token, code: m.room.code });
      setRoom(m.room);
      if (dev && soloEntry && m.room.phase !== 'PLAYING' && !soloRequested)
        startSolo(urlParams.get('name') ?? 'TESTER');
      else if (wantsLevel(m.room)) {
        levelRequested = true;
        startSolo(urlParams.get('name') ?? 'TESTER');
      }
      break;
    case 'dev-state':
      if (!dev) break;
      devPanel.update(m.state);
      // A saved hit-ray overlay asks the server for its debug events once.
      if (
        devPanel.preferences.draw.hitRays &&
        !m.state.combat?.hitDebug &&
        !hitDebugRequested &&
        room?.hostId === playerId
      ) {
        hitDebugRequested = true;
        network.send({ type: 'dev', action: 'hit-debug', enabled: true });
      }
      debugDraw.tuning = resolveTuning(m.state.tuning);
      if (m.state.solo && !soloEntry) {
        soloEntry = true;
        draw();
      }
      if (m.reset) {
        const reset = m.reset.find((r) => r.entity.id === playerId);
        if (reset) {
          predicted = reset.entity;
          previousPosition = undefined;
          pending = pending.filter((i) => i.seq > reset.ack);
          history = new Map();
          correction.x = correction.y = correction.z = 0;
        }
      }
      break;
    case 'room':
      setRoom(m.room);
      break;
    case 'snapshot': {
      renderer.push(m);
      if (m.events?.length) {
        combat.events(m.events, playerId, playerNames, world());
        debugDraw.hitDebug(m.events);
        for (const e of m.events) {
          if (
            e.t === 'hit' &&
            e.source === playerId &&
            typeof e.cause === 'number'
          )
            hitsConfirmed++;
          if (e.t === 'debug' && e.shooter === playerId) {
            const body = e.boxes.find((b) => b.max.y - b.min.y > 1);
            rewinds.push({
              requested:
                e.view === undefined
                  ? 0
                  : ((e.tick - e.view) * 1000) / tickRate,
              applied: ((e.tick - e.rewindTick) * 1000) / tickRate,
              ...(body
                ? {
                    x: (body.min.x + body.max.x) / 2,
                    z: (body.min.z + body.max.z) / 2,
                  }
                : {}),
              view: e.view,
            });
            if (rewinds.length > 60) rewinds.shift();
          }
        }
        // A respawn teleports the operator: adopt it without a smoothing slide.
        if (m.events.some((e) => e.t === 'respawn' && e.player === playerId))
          resetPrediction();
      }
      movementAudio?.remote(m.entities, playerId);
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
      const entity = m.entities.find((e) => e.id === playerId);
      if (entity) {
        const authoritative: Entity = {
          ...entity,
          ...(m.move ? { move: m.move } : {}),
          ...(m.combat ? { combat: m.combat } : {}),
        };
        authoritativeLocal = authoritative;
        input.owned = authoritative.combat?.owned ?? input.owned;
        if (restoreLook) {
          input.yaw = authoritative.yaw;
          input.pitch = authoritative.pitch;
          restoreLook = false;
        }
        const ack = m.acks[playerId] ?? 0;
        const local = history.get(ack);
        pending = pending.filter((i) => i.seq > ack);
        for (const key of history.keys()) if (key <= ack) history.delete(key);
        const playing = !!predicted && room?.phase === 'PLAYING';
        if (dead(authoritative)) {
          // Dead operators do not predict; the server owns the respawn.
          predicted = authoritative;
          history = new Map();
          previousPosition = undefined;
        } else if (
          playing &&
          local &&
          predictionMatches(local, authoritative) &&
          combatMatches(local.combat, authoritative.combat)
        ) {
          matchedSnapshots++;
          predictionError = 0;
        } else {
          if (dev && playing && local) {
            // Dev diagnostic: which part of the prediction diverged.
            const moveOk = predictionMatches(local, authoritative);
            const a = local.combat,
              b = authoritative.combat;
            lastMismatch = moveOk
              ? `combat ${
                  a && b
                    ? Object.keys(a)
                        .filter(
                          (k) =>
                            JSON.stringify(a[k as keyof typeof a]) !==
                            JSON.stringify(b[k as keyof typeof b]),
                        )
                        .join(',')
                    : 'missing'
                }`
              : 'movement';
          }
          // Any mismatch, including a sub-state field: rewind to authority and replay.
          let state = authoritative;
          history = new Map();
          for (const command of pending) {
            state = step(state, command).entity;
            history.set(command.seq, state);
          }
          if (playing && predicted) {
            predictionError = Math.hypot(
              predicted.position.x - state.position.x,
              predicted.position.y - state.position.y,
              predicted.position.z - state.position.z,
            );
            maxPredictionError = Math.max(maxPredictionError, predictionError);
            reconciliations++;
            inputDiagnostics?.correction(predictionError);
            for (const axis of ['x', 'y', 'z'] as const) {
              correction[axis] +=
                predicted.position[axis] - state.position[axis];
              if (previousPosition)
                previousPosition[axis] +=
                  state.position[axis] - predicted.position[axis];
            }
          }
          predicted = state;
          if (!playing) previousPosition = undefined;
        }
        // Health and status bits are authoritative only (never predicted).
        if (predicted) {
          predicted.health = authoritative.health;
          predicted.status = authoritative.status;
        }
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
            urlParams.get('name') ?? localStorage.getItem('name') ?? 'TESTER',
          );
      }
      draw();
      toast(m.message);
      break;
    case 'replaced':
      input.pause();
      disposeAudio();
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
const modeOf = (e?: Entity) => e?.move?.mode ?? 'GROUND';
const hspeed = (e?: Entity) => (e ? Math.hypot(e.velocity.x, e.velocity.z) : 0);
let previous = performance.now(),
  accumulator = 0;
let previousSimulation = performance.now();
// Networking/prediction must not slow down when rendering is expensive or throttled.
setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(now - previousSimulation, 250);
  previousSimulation = now;
  while (accumulator >= 1000 / tickRate) {
    if (inputDiagnostics) inputDiagnostics.ticks++;
    accumulator -= 1000 / tickRate;
    if (
      room?.phase === 'PLAYING' &&
      predicted &&
      !offline &&
      !network.replaced
    ) {
      if (pending.length >= CONFIG.maxPending) {
        resetPrediction();
        toast('Uplink delayed. Resynchronizing.');
      }
      const command = input.command(++seq, tick + pending.length + 1);
      // Lag compensation: the server rewinds targets to what this client rendered.
      if (renderer.viewTick) command.view = renderer.viewTick;
      if (dev && renderer.world && renderer.world.mode !== 'player') {
        command.x = 0;
        command.z = 0;
        command.buttons = 0;
        command.yaw = predicted.yaw;
        command.pitch = predicted.pitch;
      }
      pending.push(command);
      const before = predicted;
      previousPosition = { ...before.position };
      if (dead(predicted)) {
        history.set(command.seq, predicted);
        network.send({
          type: 'inputs',
          inputs: pending.slice(-CONFIG.maxBatch),
        });
        continue;
      }
      const out = step(predicted, command);
      predicted = out.entity;
      history.set(command.seq, predicted);
      shotsFired += out.shots.length;
      // A trigger pull from a lowered (sprinting) weapon fires after the
      // sprint-to-fire raise; that shot is counted as fired out of a sprint.
      if (before.combat?.lowered && command.buttons & FIRE_BUTTON.fire)
        sprintPull = true;
      for (const shot of out.shots) {
        void shot;
        const mode = sprintPull ? 'SPRINT' : modeOf(before);
        sprintPull = false;
        shotsByMode[mode] = (shotsByMode[mode] ?? 0) + 1;
      }
      // Predicted shots: muzzle, tracers and recoil now; the server confirms hits.
      const kick = combat.local(out, before, rules(), world());
      if (kick.yaw || kick.pitch) {
        input.yaw += kick.yaw;
        input.pitch = Math.max(-1.5, Math.min(1.5, input.pitch + kick.pitch));
      }
      network.send({ type: 'inputs', inputs: pending.slice(-CONFIG.maxBatch) });
      const was = modeOf(before),
        is = modeOf(predicted);
      reached.add(is);
      renderer.feel.tick(before, predicted);
      movementAudio?.local(before, predicted);
      if (was !== 'AIR' && is === 'AIR' && predicted.velocity.y > 5)
        void audio.play('jump', { position: predicted.position });
      const interval =
        is === 'CROUCH' ? 480 : hspeed(predicted) > 6 ? 290 : 350;
      if (
        (command.x || command.z) &&
        (is === 'GROUND' || is === 'CROUCH') &&
        hspeed(predicted) > 0.5 &&
        now - lastFootstep > interval
      ) {
        lastFootstep = now;
        worldAudio?.footstep(predicted.position);
      }
    }
  }
}, 4);
function frame(now: number) {
  const lookBefore = { yaw: input.yaw, pitch: input.pitch };
  input.frameLook();
  lastLook = {
    yaw: input.yaw - lookBefore.yaw,
    pitch: input.pitch - lookBefore.pitch,
  };
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
      const mode =
        urlParams.get('perf') === '1' ? 'perf' : urlParams.get('camera');
      if (mode) renderer.world.cameraView(mode, renderer.camera);
    }
    if (renderer.world?.ready && !worldAudio)
      worldAudio = new WorldAudio(audio, renderer.world.level);
    if (renderer.world?.ready && !movementAudio)
      movementAudio = new MovementAudio(audio, renderer.world.level);
    if (predicted) {
      worldAudio?.update(predicted.position);
      movementAudio?.frame(predicted);
    }
    renderer.world?.control(input, renderer.camera, elapsed);
    if (renderer.pair) combat.entities({ ...renderer.pair, localId: playerId });
    combat.frame({
      dt: elapsed / 1000,
      now,
      camera: renderer.camera,
      local: predicted,
      authoritative: authoritativeLocal,
      rules: rules(),
      look: lastLook,
      playing: room?.phase === 'PLAYING' && !!predicted,
      quality:
        renderer.world?.preset ??
        (graphics.quality === 'AUTO' ? 'MEDIUM' : graphics.quality),
      names: playerNames,
    });
    renderer.feel.zoom = combat.zoom;
    input.lookScale = adsLookScale(combat.ads, combat.zoom);
    renderer.render(
      room?.phase === 'PLAYING' ? predicted : undefined,
      playerId,
      playerNames,
      correction,
      predicted
        ? interpolatePosition(
            previousPosition ?? predicted.position,
            predicted.position,
            (accumulator + Math.max(0, now - previousSimulation)) /
              (1000 / tickRate),
            renderPosition,
          )
        : undefined,
      now,
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
    combat.frame({
      dt: elapsed / 1000,
      now,
      camera: renderer.camera,
      rules: rules(),
      look: lastLook,
      playing: false,
      quality: 'MEDIUM',
      names: playerNames,
    });
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
  const speed = hspeed(predicted),
    mode = modeOf(predicted);
  const speedometer = app.querySelector<HTMLElement>('.speedometer');
  if (speedometer) {
    speedometer.hidden = !movementSettings.speedometer;
    speedometer.textContent = `${speed.toFixed(1)} M/S`;
  }
  debug.hidden = !input.debug;
  debug.textContent = `SERVER TICK ${tick}\nSNAPSHOTS ${(snapshotTimes.length / 2).toFixed(1)} / ${snapshotRate} Hz\nPING ${room?.players.find((p) => p.id === playerId)?.ping ?? 0} ms\nLOSS EST. ${((100 * missingSnapshots) / Math.max(1, totalSnapshots + missingSnapshots)).toFixed(1)}%\nPREDICTION ERROR ${predictionError.toFixed(4)} m\nUNACKNOWLEDGED ${pending.length}\nENTITIES ${renderer.snapshots.at(-1)?.entities.length ?? 0}\nMOVE STATE ${mode}${predicted?.move?.crouched ? ' / CROUCHED' : ''}\nSPEED ${speed.toFixed(2)} m/s\nRECONCILED ${reconciliations} / MATCHED ${matchedSnapshots}`;
  inputDiagnostics?.frame(
    performance.now(),
    elapsed,
    renderer.camera.rotation.y,
    renderer.camera.rotation.x,
  );
  if (inputDiagnostics && dev) {
    inputDiagnostics.enabled = !!devPanel.preferences.draw.inputDiagnostics;
    // F3 collects the same bounded history even when the dedicated panel is hidden.
    inputDiagnostics.update(
      now,
      renderer.world?.preset ?? 'NONE',
      canvas.width,
      canvas.height,
      input.look.discarded,
      wallDiagnostic
        ? `WALL ${wallDiagnostic.reason}\nALONG ${wallDiagnostic.speed.toFixed(2)} / ANGLE ${wallDiagnostic.angle.toFixed(1)}° / HEIGHT ${wallDiagnostic.height.toFixed(2)}\nGAP ${wallDiagnostic.distance.toFixed(2)} / SAME LOCK ${wallDiagnostic.lockout.toFixed(2)}s / GLOBAL 0s`
        : 'WALL —',
    );
    if (input.debug) debug.textContent += '\n' + inputDiagnostics.summary;
  }
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
    wallDiagnostic,
    background: background.stats,
    world: renderer.world?.stats(),
    environmentAudio: {
      initialized: worldAudio?.initialized,
      interior: worldAudio?.interior,
      nodes: worldAudio?.nodes.length,
      filterHz: worldAudio?.filter?.frequency.value,
    },
    movement: {
      mode: modeOf(predicted),
      crouched: !!predicted?.move?.crouched,
      speed: hspeed(predicted),
      reached: [...reached],
      reconciliations,
      matchedSnapshots,
      maxPredictionError,
      camera: renderer.feel.stats(),
      audio: movementAudio?.stats(),
      poses: renderer.poses(),
    },
    perf: renderer.world?.perfReport,
    combat: {
      state: predicted?.combat,
      health: authoritativeLocal?.health,
      status: authoritativeLocal?.status,
      viewTick: renderer.viewTick,
      fx: combat.stats(),
      lastMismatch,
      shotsByMode: { ...shotsByMode },
      shotsFired,
      hitsConfirmed,
      rewinds: [...rewinds],
    },
    worldDebug: dev
      ? {
          collisionAudit: async () =>
            renderer.world
              ? (await import('./collision-sweep')).collisionSweep(
                  renderer.world,
                )
              : undefined,
          landmarkVisibility: (id?: string) =>
            renderer.world?.landmarkVisibility(renderer.camera, id),
          view: (
            position: { x: number; y: number; z: number },
            target: { x: number; y: number; z: number },
          ) => {
            if (!renderer.world) return;
            renderer.world.mode = 'free';
            renderer.camera.position.set(position.x, position.y, position.z);
            renderer.camera.lookAt(target.x, target.y, target.z);
          },
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
// Dev-only test hook: scripted input steps drive the real client without pointer lock.
Object.defineProperty(window, 'leviathanTest', {
  get: () =>
    dev
      ? {
          mouse: (x: number, y: number) => input.mouse(x, y),
          inputDiagnostics,
          diagnostics: (enabled: boolean) => {
            devPanel.preferences.draw.inputDiagnostics = enabled;
          },
          inject: (steps: InjectedInput[]) => {
            input.injected.push(...steps.map((s) => ({ ...s })));
          },
          clear: () => {
            input.injected = [];
          },
          remaining: () => input.injected.reduce((sum, s) => sum + s.ticks, 0),
          resetStats: () => {
            reached.clear();
            reconciliations = matchedSnapshots = 0;
            maxPredictionError = 0;
          },
        }
      : undefined,
});
draw();
network.connect();
requestAnimationFrame(frame);
