export type Vec3 = { x: number; y: number; z: number };
export type EntityType =
  'player' | 'robot' | 'projectile' | 'pickup' | 'hazard' | 'strike';
export type MoveMode =
  'GROUND' | 'CROUCH' | 'SLIDE' | 'AIR' | 'WALLRUN' | 'MANTLE';
/** Wall-run contact. `dir` points from the player into the wall along `axis`. */
export interface WallContact {
  id: string;
  axis: 'x' | 'z';
  dir: 1 | -1;
  plane: number;
  run: 1 | -1;
  ticks: number;
  rise: number;
}
export interface MantleState {
  ticks: number;
  total: number;
  from: Vec3;
  to: Vec3;
  axis: 'x' | 'z';
  dir: 1 | -1;
}
/** Complete deterministic movement sub-state; prediction reconciles every field. */
export interface MoveState {
  mode: MoveMode;
  buttons: number;
  airJumps: number;
  coyote: number;
  buffer: number;
  crouched: boolean;
  slideTicks: number;
  slideCooldown: number;
  wall: WallContact | null;
  lockouts: { id: string; ticks: number }[];
  mantle: MantleState | null;
  /** Short deterministic contact memory; never a jump/global latch lockout. */
  latchGrace?: {
    id: string;
    axis: 'x' | 'z';
    dir: 1 | -1;
    plane: number;
    ticks: number;
  };
}
export interface Entity {
  id: string;
  type: EntityType;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  flags: number;
  /** Compact MOTION bits, replicated in snapshots for remote poses. */
  motion?: number;
  /** Full movement state. Stripped from snapshot entities; sent to its owner only. */
  move?: MoveState;
  /** Weapon state. Owner-only, predicted and reconciled like `move`. */
  combat?: import('./combat').CombatState;
  /** Public: held weapon tier index, STATUS bits, and combat-entity details. */
  slot?: number;
  status?: number;
  kind?: string;
  owner?: string;
  radius?: number;
  timer?: number;
}
export interface Input {
  seq: number;
  tick: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  buttons: number;
  /** Wanted weapon slot (tier index). */
  weapon?: number;
  /** Server tick the client was rendering remote entities at (lag compensation). */
  view?: number;
}
export interface Box {
  min: Vec3;
  max: Vec3;
  /** Optional level metadata carried by collider boxes. */
  id?: string;
  wallRunnable?: boolean;
  /** Optional per-face restriction, named by outward normal ('+x' is the max-x face). */
  runFaces?: RunFace[];
  mantleable?: boolean;
  surface?: string;
}
export type RunFace = '+x' | '-x' | '+z' | '-z';
export interface World {
  floor: number;
  boxes: readonly Box[];
  query?: (
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
  ) => readonly Box[];
}
export type Phase = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ENDED';
export type Vote = 'REPLAY' | 'NEXT';
export interface PublicPlayer {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  ping: number;
  vote: Vote | null;
}
export interface RoomView {
  code: string;
  hostId: string;
  phase: Phase;
  mission: number;
  levelId?: string;
  levelSeed?: number;
  deadline: number;
  players: PublicPlayer[];
  result: { survived: number; present: number } | null;
  lastVote: { choice: Vote; mission: number } | null;
}
export interface Snapshot {
  type: 'snapshot';
  tick: number;
  time: number;
  entities: Entity[];
  acks: Record<string, number>;
  /** The recipient's own full movement state, for exact reconciliation. */
  move?: MoveState;
  combat?: import('./combat').CombatState;
  /** Combat events since the previous snapshot (shots, hits, blasts, pickups). */
  events?: CombatEvent[];
}
export type HitCause = number | 'blast' | 'fire' | 'fingers';
export type CombatEvent =
  | {
      t: 'shot';
      shooter: string;
      weapon: number;
      origin: Vec3;
      /** Pellet end points and whether each stopped on an entity (else world/air). */
      ends: Vec3[];
      flesh: boolean[];
      normals: (Vec3 | null)[];
    }
  | {
      t: 'hit';
      source: string;
      target: string;
      amount: number;
      zone: 'body' | 'head' | 'weak';
      kill: boolean;
      at: Vec3;
      from: Vec3;
      cause: HitCause;
    }
  | { t: 'blast'; at: Vec3; radius: number; kind: 'slag' | 'fingers' | 'flask' }
  | { t: 'ignite'; at: Vec3 }
  | { t: 'pickup'; player: string; at: Vec3 }
  | { t: 'respawn'; player: string }
  | {
      t: 'debug';
      shooter: string;
      origin: Vec3;
      ends: Vec3[];
      tick: number;
      rewindTick: number;
      /** The view tick the client asked for (before the rewind cap). */
      view?: number;
      boxes: { id: string; min: Vec3; max: Vec3 }[];
    };
export type ServerMessage =
  | {
      type: 'hello';
      protocol: number;
      tickRate: number;
      snapshotRate: number;
      dev: boolean;
      devTools: boolean;
    }
  | {
      type: 'welcome';
      token: string;
      playerId: string;
      room: RoomView;
      seq: number;
      devTools?: boolean;
    }
  | { type: 'room'; room: RoomView }
  | {
      type: 'dev-state';
      state: import('./dev').DevState;
      reset?: { entity: Entity; ack: number }[];
    }
  | Snapshot
  | { type: 'error'; code: string; message: string }
  | {
      type: 'event';
      event: 'join' | 'leave' | 'disconnect' | 'reconnect';
      name: string;
    }
  | { type: 'replaced' }
  | { type: 'ping'; time: number };
