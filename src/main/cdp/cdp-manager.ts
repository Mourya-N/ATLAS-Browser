import type { WebContents } from 'electron';

export interface CDPConnection {
  tabId: string;
  webContents: WebContents;
  attached: boolean;
  enabledDomains: Set<string>;
}

export class CDPManager {
  private connections = new Map<string, CDPConnection>();

  public async attach(tabId: string, webContents: WebContents): Promise<CDPConnection> {
    if (webContents.isDestroyed()) {
      throw new Error(`WebContents for tab ${tabId} is destroyed`);
    }

    const existing = this.connections.get(tabId);
    if (existing && existing.attached && webContents.debugger.isAttached()) {
      return existing;
    }

    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3');
    }

    const conn: CDPConnection = {
      tabId,
      webContents,
      attached: true,
      enabledDomains: new Set()
    };

    webContents.debugger.once('detach', () => {
      conn.attached = false;
      conn.enabledDomains.clear();
      this.connections.delete(tabId);
    });

    webContents.once('destroyed', () => {
      conn.attached = false;
      this.connections.delete(tabId);
    });

    this.connections.set(tabId, conn);
    return conn;
  }

  public async sendCommand<T = unknown>(
    tabId: string,
    webContents: WebContents,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const conn = await this.attach(tabId, webContents);
    const domain = method.split('.')[0];
    if (
      (domain === 'DOM' || domain === 'Accessibility' || domain === 'Page' || domain === 'Runtime') &&
      !conn.enabledDomains.has(domain)
    ) {
      await webContents.debugger.sendCommand(`${domain}.enable`);
      conn.enabledDomains.add(domain);
    }
    return (await webContents.debugger.sendCommand(method, params)) as T;
  }

  public async evaluateInternal<T = unknown>(
    tabId: string,
    webContents: WebContents,
    expression: string
  ): Promise<T> {
    const res = await this.sendCommand<{
      result?: { value?: T; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>(tabId, webContents, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    if (res.exceptionDetails) {
      const msg =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        'CDP Runtime.evaluate error';
      throw new Error(msg);
    }
    return res.result?.value as T;
  }

  public async getAccessibilityTree(tabId: string, webContents: WebContents): Promise<unknown[]> {
    const res = await this.sendCommand<{ nodes?: unknown[] }>(
      tabId,
      webContents,
      'Accessibility.getFullAXTree',
      {}
    );
    return res.nodes ?? [];
  }

  public async captureScreenshot(tabId: string, webContents: WebContents): Promise<string> {
    const res = await this.sendCommand<{ data: string }>(
      tabId,
      webContents,
      'Page.captureScreenshot',
      { format: 'png', fromSurface: true }
    );
    return res.data;
  }

  public async clickAt(tabId: string, webContents: WebContents, x: number, y: number): Promise<void> {
    await this.sendCommand(tabId, webContents, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y
    });
    await this.sendCommand(tabId, webContents, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    await this.sendCommand(tabId, webContents, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
  }

  public async hoverAt(tabId: string, webContents: WebContents, x: number, y: number): Promise<void> {
    await this.sendCommand(tabId, webContents, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y
    });
  }

  public async dragBetween(
    tabId: string,
    webContents: WebContents,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): Promise<void> {
    await this.sendCommand(tabId, webContents, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: fromX,
      y: fromY
    });
    await this.sendCommand(tabId, webContents, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: fromX,
      y: fromY,
      button: 'left',
      clickCount: 1
    });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const ix = fromX + ((toX - fromX) * i) / steps;
      const iy = fromY + ((toY - fromY) * i) / steps;
      await this.sendCommand(tabId, webContents, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: ix,
        y: iy,
        button: 'left'
      });
    }
    await this.sendCommand(tabId, webContents, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: toX,
      y: toY,
      button: 'left',
      clickCount: 1
    });
  }

  public async insertText(tabId: string, webContents: WebContents, text: string): Promise<void> {
    await this.sendCommand(tabId, webContents, 'Input.insertText', { text });
  }

  public async pressKey(tabId: string, webContents: WebContents, key: string): Promise<void> {
    const keyMap: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }
    };
    const spec = keyMap[key] ?? {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
    };

    await this.sendCommand(tabId, webContents, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.windowsVirtualKeyCode
    });
    await this.sendCommand(tabId, webContents, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.windowsVirtualKeyCode
    });
  }

  public detach(tabId: string): void {
    const conn = this.connections.get(tabId);
    if (!conn) return;
    try {
      if (!conn.webContents.isDestroyed() && conn.webContents.debugger.isAttached()) {
        conn.webContents.debugger.detach();
      }
    } catch {
      // ignore
    }
    conn.attached = false;
    this.connections.delete(tabId);
  }

  public detachAll(): void {
    for (const tabId of Array.from(this.connections.keys())) {
      this.detach(tabId);
    }
  }
}
