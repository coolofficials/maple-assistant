import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedPermissionRequest, CaptureSourceGate, NotificationScheduler, trustedCaptureOrigin, trustedEditorSender, trustedPageUrl, validNotificationPayload } from './security';
afterEach(() => { vi.useRealTimers(); });
describe('Electron trust boundary', () => {
  it('allows only the selected display-capture permission from the trusted editor', () => {
    expect(allowedPermissionRequest('display-capture', true, true)).toBe(true);
    expect(allowedPermissionRequest('display-capture', true, false)).toBe(false);
    expect(allowedPermissionRequest('display-capture', false, true)).toBe(false);
    expect(allowedPermissionRequest('media', true, true, [])).toBe(true);
    expect(allowedPermissionRequest('media', true, true, ['video'])).toBe(false);
    expect(allowedPermissionRequest('media', true, true)).toBe(false);
    expect(allowedPermissionRequest('notifications', true, true)).toBe(false);
  });
  it('accepts only exact editor URL, WebContents main frame and selected file/development origin', () => {
    const mainFrame = { url: 'file:///app/dist/index.html' }; const sender = { mainFrame };
    expect(trustedPageUrl(mainFrame.url, 'http://127.0.0.1:5173/', mainFrame.url)).toBe(true);
    expect(trustedPageUrl('file:///app/evil.html', 'http://127.0.0.1:5173/', mainFrame.url)).toBe(false);
    expect(trustedPageUrl('http://127.0.0.1:5173.evil.test/', 'http://127.0.0.1:5173/', mainFrame.url)).toBe(false);
    expect(trustedPageUrl('data:text/html,<script>window.desktop</script>', 'http://127.0.0.1:5173/', mainFrame.url)).toBe(false);
    expect(trustedPageUrl(`${mainFrame.url}#pip`, mainFrame.url)).toBe(true);
    expect(trustedPageUrl(`${mainFrame.url}#unknown`, mainFrame.url)).toBe(false);
    expect(trustedPageUrl(`${mainFrame.url}?unexpected=1#pip`, mainFrame.url)).toBe(false);
    expect(trustedPageUrl('file:///app/other.html#pip', mainFrame.url)).toBe(false);
    expect(trustedEditorSender({ sender, senderFrame: mainFrame }, sender, 'http://127.0.0.1:5173/', mainFrame.url)).toBe(true);
    expect(trustedEditorSender({ sender, senderFrame: { url: mainFrame.url } }, sender, 'http://127.0.0.1:5173/', mainFrame.url)).toBe(false);
    expect(trustedCaptureOrigin('null', mainFrame.url)).toBe(true);
    expect(trustedCaptureOrigin('https://evil.test', mainFrame.url)).toBe(false);
    expect(trustedCaptureOrigin('http://127.0.0.1:5173', 'http://127.0.0.1:5173/')).toBe(true);
    expect(trustedCaptureOrigin('http://127.0.0.1:5173/', 'http://127.0.0.1:5173/')).toBe(true);
    expect(trustedCaptureOrigin('http://127.0.0.1:5173/evil', 'http://127.0.0.1:5173/')).toBe(false);
  });
  it('allows only gesture-backed video-only capture of a source already selected from the native source list', () => {
    const gate = new CaptureSourceGate<{ name: string }>(); const screen = { name: 'chosen screen' }; const other = { name: 'other screen' };
    gate.replace([{ id: 'screen:1', source: screen }, { id: 'screen:2', source: other }]);
    expect(gate.select('screen:missing')).toBe(false); expect(gate.select('screen:1')).toBe(true);
    expect(gate.select('screen:missing')).toBe(false);
    expect(gate.grant({ trusted: true, userGesture: true, videoRequested: true, audioRequested: false })).toBeNull();
    expect(gate.select('screen:1')).toBe(true);
    expect(gate.grant({ trusted: false, userGesture: true, videoRequested: true, audioRequested: false })).toBeNull();
    expect(gate.grant({ trusted: true, userGesture: false, videoRequested: true, audioRequested: false })).toBeNull();
    expect(gate.grant({ trusted: true, userGesture: true, videoRequested: true, audioRequested: true })).toBeNull();
    expect(gate.grant({ trusted: true, userGesture: true, videoRequested: true, audioRequested: false })).toBe(screen);
    gate.replace([{ id: 'screen:2', source: other }]);
    expect(gate.grant({ trusted: true, userGesture: true, videoRequested: true, audioRequested: false })).toBeNull();
    gate.clear(); expect(gate.select('')).toBe(true);
  });
  it('validates notification contents and schedules/cancels main-process deadlines', () => {
    expect(validNotificationPayload('Skill', 'ready')).toBe(true); expect(validNotificationPayload('', 'ready')).toBe(false); expect(validNotificationPayload('A'.repeat(81), '')).toBe(false);
    vi.useFakeTimers(); const scheduler = new NotificationScheduler(); const notify = vi.fn();
    const id = scheduler.schedule(2000, notify); vi.advanceTimersByTime(1999); expect(notify).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(notify).toHaveBeenCalledOnce();
    const cancelled = scheduler.schedule(1000, notify); scheduler.cancel(cancelled.id); vi.advanceTimersByTime(2000); expect(notify).toHaveBeenCalledOnce();
    scheduler.schedule(1000, notify); scheduler.clear(); vi.advanceTimersByTime(1000); expect(notify).toHaveBeenCalledOnce(); expect(id.id).not.toBe(cancelled.id);
  });
  it('fires at receipt-relative deadlines repeatedly until its cancellation ID is canceled', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2025-02-01T00:00:00Z')); const scheduler = new NotificationScheduler(); const firedAt: number[] = [];
    vi.advanceTimersByTime(125); const schedule = scheduler.schedule(500, () => firedAt.push(Date.now()), 500);
    expect(schedule.scheduledAt).toBe(Date.parse('2025-02-01T00:00:00.125Z'));
    vi.advanceTimersByTime(499); expect(firedAt).toEqual([]); vi.advanceTimersByTime(1); expect(firedAt).toEqual([Date.parse('2025-02-01T00:00:00.625Z')]);
    vi.advanceTimersByTime(500); expect(firedAt).toEqual([Date.parse('2025-02-01T00:00:00.625Z'), Date.parse('2025-02-01T00:00:01.125Z')]);
    scheduler.cancel(schedule.id); vi.advanceTimersByTime(1000); expect(firedAt).toHaveLength(2);
  });
});
