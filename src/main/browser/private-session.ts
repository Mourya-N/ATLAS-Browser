import { session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AdBlocker } from './ad-blocker';

export class PrivateSessionManager {
  private sessions = new Map<string, Electron.Session>();

  public createEphemeralSession(adBlocker?: AdBlocker): { partitionId: string; sess: Electron.Session } {
    const partitionId = `lavray-private-${randomUUID()}`;
    // Partition WITHOUT `persist:` prefix is strictly in-memory & isolated
    const sess = session.fromPartition(partitionId, { cache: false });
    sess.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });
    adBlocker?.attachToSession(sess);
    this.sessions.set(partitionId, sess);
    return { partitionId, sess };
  }

  public async destroyEphemeralSession(partitionId: string): Promise<void> {
    const sess = this.sessions.get(partitionId);
    if (!sess) return;
    this.sessions.delete(partitionId);
    try {
      await sess.clearStorageData();
      await sess.clearCache();
      await sess.clearAuthCache();
    } catch (err) {
      console.error('[PrivateSession] Cleanup warning:', err);
    }
  }

  public getActiveCount(): number {
    return this.sessions.size;
  }
}
