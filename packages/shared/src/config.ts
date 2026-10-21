export const CONFIG = {
  protocol: 1,
  tickRate: 60,
  snapshotRate: 30,
  maxPlayers: 8,
  countdownMs: 5000,
  matchMs: 300000,
  voteMs: 20000,
  reconnectMs: 45000,
  emptyRoomMs: 60000,
  heartbeatMs: 2000,
  deadMs: 8000,
  interpolationMs: 100,
  maxMessageBytes: 16384,
  maxQueue: 30,
  maxBatch: 12,
  maxMessagesPerSecond: 120,
  maxPending: 240,
} as const;
export const MISSIONS = [
  'Factory 1',
  'Factory 2',
  'Factory 3',
  'Factory 4',
  'Factory 5',
  'Factory 6',
  'VANE SS',
];
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BUTTON = { jump: 1, sprint: 2 } as const;
export const FLAG = { grounded: 1, disconnected: 2 } as const;
export const PHYSICS = {
  walk: 5,
  sprint: 8,
  jump: 7,
  gravity: 20,
  radius: 0.35,
  height: 1.8,
  arena: 120,
  stepHeight: 0.5,
};
