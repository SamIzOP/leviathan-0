export type Vec3 = { x: number; y: number; z: number };
export type EntityType = 'player' | 'robot' | 'projectile' | 'pickup';
export interface Entity {
  id: string;
  type: EntityType;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  flags: number;
}
export interface Input {
  seq: number;
  tick: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  buttons: number;
}
export interface Box {
  min: Vec3;
  max: Vec3;
}
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
}
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
