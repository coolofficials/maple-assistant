export interface FrameLike { url: string; }
export interface SenderLike { mainFrame: FrameLike; }
export interface IpcLike { sender: SenderLike; senderFrame: FrameLike | null; }

const appFragments = new Set(['#timer', '#todos', '#pip', '#data']);
export function trustedPageUrl(candidate: string, ...allowedUrls: string[]): boolean {
  let target: URL;
  try { target = new URL(candidate); } catch { return false; }
  if (target.hash && !appFragments.has(target.hash)) return false;
  return allowedUrls.some(allowed => {
    try {
      const base = new URL(allowed);
      return target.protocol === base.protocol && target.origin === base.origin && target.username === base.username && target.password === base.password && target.host === base.host && target.pathname === base.pathname && target.search === base.search;
    } catch { return false; }
  });
}

export function trustedEditorSender(event: IpcLike, editor: SenderLike | null, developmentUrl: string, packagedFileUrl: string): boolean {
  return Boolean(editor && event.sender === editor && event.senderFrame === editor.mainFrame && trustedPageUrl(event.senderFrame.url, developmentUrl, packagedFileUrl));
}

export function trustedCaptureOrigin(securityOrigin: string, pageUrl: string): boolean {
  const base = new URL(pageUrl);
  if (pageUrl.startsWith('file:') && securityOrigin === 'null') return true;
  try {
    const supplied = new URL(securityOrigin);
    return supplied.origin === base.origin && supplied.pathname === '/' && !supplied.search && !supplied.hash && !supplied.username && !supplied.password;
  } catch { return false; }
}

export function allowedPermissionRequest(permission: string, trustedEditor: boolean, hasSelectedSource: boolean, mediaTypes?: readonly string[]): boolean {
  if (!trustedEditor || !hasSelectedSource) return false;
  return permission === 'display-capture' || (permission === 'media' && mediaTypes?.length === 0);
}

export function validNotificationPayload(title: unknown, body: unknown): title is string {
  return typeof title === 'string' && title.trim().length > 0 && title.length <= 80 && typeof body === 'string' && body.length <= 240;
}

export class CaptureSourceGate<T> {
  private sources = new Map<string, T>();
  private selected: string | null = null;
  replace(sources: Array<{ id: string; source: T }>) {
    this.sources = new Map(sources.map(({ id, source }) => [id, source]));
    if (!this.sources.has(this.selected ?? '')) this.selected = null;
  }
  select(id: unknown): boolean {
    if (id === '') { this.selected = null; return true; }
    if (typeof id !== 'string' || !this.sources.has(id)) { this.selected = null; return false; }
    this.selected = id;
    return true;
  }
  grant(request: { trusted: boolean; userGesture: boolean; videoRequested: boolean; audioRequested: boolean }): T | null {
    if (!request.trusted || !request.userGesture || !request.videoRequested || request.audioRequested || !this.selected) return null;
    return this.sources.get(this.selected) ?? null;
  }
  get hasSelection() { return this.selected !== null && this.sources.has(this.selected); }
  clear() { this.sources.clear(); this.selected = null; }
}

export interface ScheduledNotification { id: string; scheduledAt: number; }
type ScheduledTask = { timer: ReturnType<typeof setTimeout>; repeatMs: number; notify: () => void };
export class NotificationScheduler {
  private timers = new Map<string, ScheduledTask>();
  private nextId = 0;
  schedule(delayMs: number, notify: () => void, repeatMs = 0): ScheduledNotification {
    const id = String(++this.nextId); const scheduledAt = Date.now();
    const task: ScheduledTask = { timer: setTimeout(() => this.fire(id), delayMs), repeatMs, notify };
    this.timers.set(id, task);
    return { id, scheduledAt };
  }
  private fire(id: string) {
    const task = this.timers.get(id); if (!task) return;
    try { task.notify(); } finally {
      if (task.repeatMs > 0 && this.timers.get(id) === task) task.timer = setTimeout(() => this.fire(id), task.repeatMs);
      else this.timers.delete(id);
    }
  }
  cancel(id: string) { const task = this.timers.get(id); if (task) clearTimeout(task.timer); this.timers.delete(id); }
  clear() { for (const task of this.timers.values()) clearTimeout(task.timer); this.timers.clear(); }
}
