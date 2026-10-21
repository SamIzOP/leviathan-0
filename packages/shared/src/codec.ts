import { z } from 'zod';
import { CONFIG } from './config';
import type { ServerMessage } from './types';
import { DEV_ACTIONS } from './dev';
const finite = z.number().finite();
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
    })
    .strict(),
  z
    .object({
      type: z.literal('dev'),
      action: z.enum(DEV_ACTIONS),
      enabled: z.boolean().optional(),
      count: z.number().int().min(1).max(10).optional(),
      tuning: z
        .object({
          walk: z.number().min(1).max(15),
          sprint: z.number().min(1).max(25),
          jumpHeight: z.number().min(0.1).max(8),
          gravity: z.number().min(2).max(40),
        })
        .strict()
        .optional(),
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
