import type { IpcMainInvokeEvent } from 'electron';
import type { ZodSchema } from 'zod';

export interface TrustedSenderPolicy {
  trustedWebContentsId: () => number | null;
  allowOrigins: string[];
}

export function validateIpcSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  policy: TrustedSenderPolicy
): { valid: boolean; reason?: string } {
  const expectedId = policy.trustedWebContentsId();
  if (expectedId === null || event.sender.id !== expectedId) {
    return { valid: false, reason: 'Unauthorized IPC sender webContents' };
  }

  const frameUrl = event.senderFrame?.url || event.sender.getURL?.() || '';
  if (!frameUrl) {
    return { valid: false, reason: 'Missing sender frame URL' };
  }

  const allowed = policy.allowOrigins.some((prefix) => frameUrl.startsWith(prefix));
  if (!allowed) {
    return { valid: false, reason: `Disallowed sender origin: ${frameUrl}` };
  }

  return { valid: true };
}

export function validateIpcPayload<T>(schema: ZodSchema<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid IPC payload: ${details}`);
  }
  return parsed.data;
}
