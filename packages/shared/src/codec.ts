import { z } from 'zod';
import { CONFIG, MOVE_LIMITS, type MoveTuning } from './config';
import type { ServerMessage } from './types';
import { DEV_ACTIONS } from './dev';
const finite = z.number().finite();
// Any subset of movement constants, each inside its dev bounds.
const tuning = z
  .object(
    Object.fromEntries(
      Object.entries(MOVE_LIMITS).map(([key, [min, max]]) => [
        key,
        z.number().min(min).max(max),
      ]),
    ) as Record<keyof MoveTuning, z.ZodNumber>,
  )
  .partial()
  .strict();
/** Dev-only test levels selectable from a solo entry. */
export const DEV_LEVELS = { lab: 'movement-lab' } as const;
const input = z
  .object({
    seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    tick: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    x: finite,
    z: finite,
    yaw: finite,
    pitch: finite,
    buttons: z.number().int().min(0).max(255),
  })
  .strict();
export const clientSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('dev-solo'),
      protocol: z.number().int(),
      name: z.string().max(64),
      level: z.enum(['lab']).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('dev'),
      action: z.enum(DEV_ACTIONS),
      enabled: z.boolean().optional(),
      count: z.number().int().min(1).max(10).optional(),
      tuning: tuning.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('create'),
      protocol: z.number().int(),
      name: z.string().max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal('join'),
      protocol: z.number().int(),
      name: z.string().max(64),
      code: z.string().max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal('resume'),
      protocol: z.number().int(),
      token: z.string().min(16).max(128),
      code: z.string().max(8),
    })
    .strict(),
  z.object({ type: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('leave') }).strict(),
  z.object({ type: z.literal('lobby') }).strict(),
  z
    .object({ type: z.literal('vote'), vote: z.enum(['REPLAY', 'NEXT']) })
    .strict(),
  z
    .object({
      type: z.literal('inputs'),
      inputs: z.array(input).max(CONFIG.maxBatch),
    })
    .strict(),
  z.object({ type: z.literal('pong'), time: finite }).strict(),
  z
    .object({ type: z.literal('debug'), action: z.enum(['end', 'robot']) })
    .strict(),
]);
export type ClientMessage = z.infer<typeof clientSchema>;
export function decodeClient(raw: string): ClientMessage | null {
  try {
    const parsed = clientSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
// Server is trusted; this boundary is the only place the JSON representation leaks.
export function decodeServer(raw: string): ServerMessage {
  return JSON.parse(raw) as ServerMessage;
}
