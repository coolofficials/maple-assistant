import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadData } from './model';
import { NotificationScheduler } from '../electron/security';

const KEY = 'maple-assistant-data-v1';
const id1 = '123e4567-e89b-42d3-a456-426614174000';
const id2 = '123e4567-e89b-42d3-a456-426614174001';
const generatedId = (n: number) => `${n.toString(16).padStart(8,'0')}-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const validData = (overrides: Record<string, unknown> = {}) => ({ skills: [], todos: [], characters: ['A'], selectedCharacter: 'A', ...overrides });
let desktop: Record<string, ReturnType<typeof vi.fn>>;
let getDisplayMedia: ReturnType<typeof vi.fn>;
let resolveCapture: (stream: MediaStream) => void;
let trackStop: ReturnType<typeof vi.fn>;
let trackEnded: (() => void) | undefined;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function useMainNotificationScheduler(ipcDelayMs = 0) {
  const scheduler = new NotificationScheduler(); const fired: Array<{ title: string; at: number }> = []; const canceled: string[] = [];
  desktop.scheduleNotification.mockImplementation(async (title: string, _body: string, delay: number, repeat = 0) => {
    if (ipcDelayMs) await new Promise<void>(resolve => setTimeout(resolve, ipcDelayMs));
    return scheduler.schedule(delay, () => fired.push({ title, at: Date.now() }), repeat);
  });
  desktop.cancelNotification.mockImplementation(async (id: string) => { canceled.push(id); scheduler.cancel(id); return true; });
  return { scheduler, fired, canceled };
}
async function mount() { vi.resetModules(); await import('./main'); }
function setFile(input: HTMLInputElement, value: string) {
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: value.length, text: async () => value }] });
  return input.onchange!({ currentTarget: input } as unknown as Event);
}
function fakeStream(): MediaStream {
  trackStop = vi.fn(); trackEnded = undefined; const track = { stop: trackStop, addEventListener: vi.fn((event: string, callback: () => void) => { if (event === 'ended') trackEnded = callback; }) };
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'; localStorage.clear();
  desktop = { listSources: vi.fn().mockResolvedValue([{ id: 'screen:1', name: 'Safe screen' }]), selectSource: vi.fn().mockResolvedValue(true), openObserver: vi.fn().mockResolvedValue(true), publishFrame: vi.fn().mockResolvedValue(true), closeObserver: vi.fn().mockResolvedValue(true), scheduleNotification: vi.fn().mockResolvedValue('notice-1'), cancelNotification: vi.fn().mockResolvedValue(true), onFrame: vi.fn().mockReturnValue(vi.fn()) };
  Object.defineProperty(window, 'desktop', { configurable: true, value: desktop });
  let capturePromise: Promise<MediaStream>;
  getDisplayMedia = vi.fn(() => capturePromise);
  capturePromise = new Promise(resolve => { resolveCapture = resolve; });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { window.dispatchEvent(new Event('beforeunload')); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('renderer startup and safe UI', () => {
  it('saves character cooldown specs, switches characters, and restores each spec', async () => {
    const data = { ...validData({ characters: ['A', 'B'], selectedCharacter: 'A' }), characterCooldownSpecs: [{ characterName: 'A', reductionPct: 0, reductionSec: 0 }, { characterName: 'B', reductionPct: 4, reductionSec: 1 }] };
    localStorage.setItem(KEY, JSON.stringify(data)); await mount();
    const pct = document.querySelector<HTMLInputElement>('#character-reduction-pct')!; const sec = document.querySelector<HTMLInputElement>('#character-reduction-sec')!;
    pct.value = '23'; sec.value = '8'; document.querySelector<HTMLButtonElement>('#save-character-spec')!.click();
    let stored = loadData(localStorage); expect(stored.characterCooldownSpecs[0]).toMatchObject({ characterName: 'A', reductionPct: 23, reductionSec: 8 });
    const character = document.querySelector<HTMLSelectElement>('#character')!; character.value = 'B'; character.dispatchEvent(new Event('change'));
    expect(pct.value).toBe('4'); expect(sec.value).toBe('1'); pct.value = '12'; sec.value = '3'; document.querySelector<HTMLButtonElement>('#save-character-spec')!.click();
    character.value = 'A'; character.dispatchEvent(new Event('change')); expect(pct.value).toBe('23'); expect(sec.value).toBe('8'); stored = loadData(localStorage);
    expect(stored.characterCooldownSpecs.map(item => [item.reductionPct, item.reductionSec])).toEqual([[23,8],[12,3]]);
  });
  it('mounts Korean editor UI and character dialog rejects reserved/duplicate names without prompt', async () => {
    localStorage.setItem(KEY, JSON.stringify(validData())); await mount(); expect(document.querySelector('h1')?.textContent).toBe('메이플 어시스턴트');
    document.querySelector<HTMLButtonElement>('#add-character')!.click();
    const input = document.querySelector<HTMLInputElement>('#character-form input')!; const form = document.querySelector<HTMLFormElement>('#character-form')!;
    input.value = 'account'; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); expect(document.querySelector('#character-error')?.textContent).toContain('account');
    input.value = 'a'; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); expect(document.querySelector('#character-error')?.textContent).toContain('이미 등록');
    input.value = 'B'; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); expect([...document.querySelectorAll('#character option')].map(o => o.textContent)).toEqual(['A', 'B']);
  });
  it('keeps in-app nav clicks in the trusted document URL', async () => {
    await mount(); const before = location.href;
    for (const id of ['timer', 'todos', 'pip', 'data']) document.querySelector<HTMLAnchorElement>(`nav a[href="#${id}"]`)!.click();
    expect(location.href).toBe(before); expect(location.hash).toBe('');
  });
  it('renders imported free text as text, rejects malicious IDs and preserves persisted data on failure', async () => {
    const saved = validData({ todos: [{ id: id1, title: 'original', scope: 'account', frequency: 'daily', resetWeekday: 1, resetTime: '00:00', customDays: 7 }] });
    localStorage.setItem(KEY, JSON.stringify(saved)); await mount(); const before = localStorage.getItem(KEY);
    const malicious = validData({ todos: [{ id: '"><img src=x onerror=alert(1)>', title: '<img id="owned" src=x>', scope: 'account', frequency: 'daily', resetWeekday: 1, resetTime: '00:00', customDays: 7 }] });
    await setFile(document.querySelector<HTMLInputElement>('#import')!, JSON.stringify(malicious));
    expect(localStorage.getItem(KEY)).toBe(before); expect(document.querySelector('#owned')).toBeNull(); expect(document.querySelector('#todos-list')?.textContent).toContain('original');
    const safeText = validData({ todos: [{ id: id2, title: '<img id="owned" src=x>', scope: 'account', frequency: 'daily', resetWeekday: 1, resetTime: '00:00', customDays: 7 }] });
    await setFile(document.querySelector<HTMLInputElement>('#import')!, JSON.stringify(safeText)); expect(document.querySelector('#owned')).toBeNull(); expect(document.querySelector('#todos-list')?.textContent).toContain('<img id="owned" src=x>');
  });
  it('rejects a normal skill addition over the shared schema cap without mutating storage or UI state', async () => {
    const data = validData({ skills: Array.from({ length: 500 }, (_, i) => ({ id: generatedId(i + 1), name: `Skill ${i}`, cooldownSec: 60, reductionPct: 0 })) });
    localStorage.setItem(KEY, JSON.stringify(data)); await mount(); const before = localStorage.getItem(KEY);
    const form = document.querySelector<HTMLFormElement>('#skill-form')!;
    (form.elements.namedItem('name') as HTMLInputElement).value = 'Extra';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(localStorage.getItem(KEY)).toBe(before); expect(document.querySelectorAll('#skills article')).toHaveLength(500);
    expect(document.querySelector('#data-status')?.textContent).toContain('최대 개수 제한');
    window.dispatchEvent(new Event('beforeunload')); await mount(); expect(loadData(localStorage).skills).toHaveLength(500);
  });
  it('preserves old data if localStorage quota errors during import and reports failure', async () => {
    const saved = validData(); localStorage.setItem(KEY, JSON.stringify(saved)); await mount();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await setFile(document.querySelector<HTMLInputElement>('#import')!, JSON.stringify(validData({ characters: ['New'], selectedCharacter: 'New' })));
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(saved)); expect(document.querySelector('#data-status')?.textContent).toContain('저장 공간');
  });
});
describe('capture and lifecycle', () => {
  it('is gesture-triggered, blocks duplicate start, cancels a pending request, and stops late stream tracks', async () => {
    await mount(); document.querySelector<HTMLButtonElement>('#refresh-sources')!.click(); await flush();
    const select = document.querySelector<HTMLSelectElement>('#source')!; select.value = 'screen:1'; select.dispatchEvent(new Event('change')); await flush();
    const start = document.querySelector<HTMLButtonElement>('#start-capture')!; start.click(); start.click(); expect(getDisplayMedia).toHaveBeenCalledOnce(); expect(getDisplayMedia).toHaveBeenCalledWith({ audio: false, video: { frameRate: { ideal: 10, max: 15 } } });
    document.querySelector<HTMLButtonElement>('#stop-capture')!.click(); expect(document.querySelector('#capture-status')?.textContent).toContain('중지했습니다'); const stream = fakeStream(); resolveCapture(stream); await flush();
    expect(trackStop).toHaveBeenCalledOnce(); expect(desktop.openObserver).not.toHaveBeenCalled(); expect(desktop.publishFrame).not.toHaveBeenCalled();
  });
  it('starts only after selection and import cleans an active stream and observer', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    await mount(); document.querySelector<HTMLButtonElement>('#refresh-sources')!.click(); await flush();
    const select = document.querySelector<HTMLSelectElement>('#source')!; select.value = 'screen:1'; select.dispatchEvent(new Event('change')); await flush();
    const stream = fakeStream(); getDisplayMedia.mockImplementation(() => Promise.resolve(stream));
    document.querySelector<HTMLButtonElement>('#start-capture')!.click(); await flush();
    expect(desktop.openObserver).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(2);
    expect(document.querySelector<HTMLButtonElement>('#stop-capture')!.disabled).toBe(false);
    await setFile(document.querySelector<HTMLInputElement>('#import')!, JSON.stringify(validData({ characters: ['Imported'], selectedCharacter: 'Imported' })));
    expect(trackStop).toHaveBeenCalledOnce(); expect(desktop.closeObserver).toHaveBeenCalled(); expect(document.querySelector('#capture-status')?.textContent).toContain('캡처를 중지'); expect(document.querySelector<HTMLSelectElement>('#character')?.value).toBe('Imported'); expect(vi.getTimerCount()).toBe(1);
  });
  it('reports capture denial and unlocks start without leaking a stream', async () => {
    await mount(); document.querySelector<HTMLButtonElement>('#refresh-sources')!.click(); await flush();
    const select = document.querySelector<HTMLSelectElement>('#source')!; select.value = 'screen:1'; desktop.selectSource.mockResolvedValue(false); select.dispatchEvent(new Event('change')); await flush();
    expect(document.querySelector<HTMLButtonElement>('#start-capture')!.disabled).toBe(true); expect(getDisplayMedia).not.toHaveBeenCalled();
    desktop.selectSource.mockResolvedValue(true); select.dispatchEvent(new Event('change')); await flush(); getDisplayMedia.mockRejectedValue(new Error('permission denied'));
    document.querySelector<HTMLButtonElement>('#start-capture')!.click(); await flush();
    expect(document.querySelector('#capture-status')?.textContent).toContain('시작하지 못했습니다.'); expect(document.querySelector<HTMLButtonElement>('#start-capture')!.disabled).toBe(false);
  });
  it('cleans stream and observer and announces capture end when the OS ends its track', async () => {
    vi.useFakeTimers(); await mount(); document.querySelector<HTMLButtonElement>('#refresh-sources')!.click(); await flush();
    const select = document.querySelector<HTMLSelectElement>('#source')!; select.value = 'screen:1'; select.dispatchEvent(new Event('change')); await flush();
    const stream = fakeStream(); getDisplayMedia.mockImplementation(() => Promise.resolve(stream)); document.querySelector<HTMLButtonElement>('#start-capture')!.click(); await flush();
    trackEnded?.(); expect(trackStop).toHaveBeenCalledOnce(); expect(desktop.closeObserver).toHaveBeenCalled();
    expect(document.querySelector('#capture-status')?.textContent).toContain('중지했습니다'); expect(document.querySelector<HTMLButtonElement>('#stop-capture')!.disabled).toBe(true); expect(vi.getTimerCount()).toBe(1);
  });
  it('starts a newly added first skill and then the explicitly selected second skill', async () => {
    vi.useFakeTimers(); localStorage.setItem(KEY, JSON.stringify(validData())); await mount(); useMainNotificationScheduler();
    const form = document.querySelector<HTMLFormElement>('#skill-form')!;
    const add = (name: string, seconds: number) => { (form.elements.namedItem('name') as HTMLInputElement).value = name; (form.elements.namedItem('cooldown') as HTMLInputElement).value = String(seconds); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };
    add('First', 3); await flush(); const chooser = document.querySelector<HTMLSelectElement>('#active-skill')!;
    expect(chooser.value).toBe(loadData(localStorage).skills[0].id); document.querySelector<HTMLButtonElement>('#start-timer')!.click(); await flush();
    expect(desktop.scheduleNotification.mock.calls[0][0]).toBe('First'); document.querySelector<HTMLButtonElement>('#stop-timer')!.click();
    add('Second', 5); await flush(); const second = loadData(localStorage).skills[1]; chooser.value = second.id; chooser.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('#start-timer')!.click(); await flush(); expect(desktop.scheduleNotification.mock.calls.at(-1)?.[0]).toBe('Second');
  });
  it('uses main scheduler deadlines despite IPC delay and repeats actual native-notification callbacks', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-01T00:00:00Z')); const { fired } = useMainNotificationScheduler(100);
    localStorage.setItem(KEY, JSON.stringify(validData({ skills: [{ id: id1, name: 'Buff', cooldownSec: 3, reductionPct: 0 }] })));
    await mount(); document.querySelector<HTMLButtonElement>('#start-timer')!.click(); await vi.advanceTimersByTimeAsync(100);
    expect(desktop.scheduleNotification).toHaveBeenCalledWith('Buff', 'Buff 쿨타임이 끝났습니다.', 3000, 3000);
    await vi.advanceTimersByTimeAsync(2999); expect(fired).toHaveLength(0); await vi.advanceTimersByTimeAsync(1); expect(fired.map(n => n.at)).toEqual([Date.parse('2025-01-01T00:00:03.100Z')]);
    await vi.advanceTimersByTimeAsync(3000); expect(fired.map(n => n.at)).toEqual([Date.parse('2025-01-01T00:00:03.100Z'), Date.parse('2025-01-01T00:00:06.100Z')]);
    await setFile(document.querySelector<HTMLInputElement>('#import')!, JSON.stringify(validData())); await vi.advanceTimersByTimeAsync(6000); expect(fired).toHaveLength(2);
  });
  it('pauses at 500ms remaining, remains silent, and fires once at the exact resumed deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-01T00:00:00Z')); const { fired } = useMainNotificationScheduler();
    localStorage.setItem(KEY, JSON.stringify(validData({ skills: [{ id: id1, name: 'Quick', cooldownSec: 3, reductionPct: 0 }] })));
    await mount(); document.querySelector<HTMLButtonElement>('#start-timer')!.click(); await flush(); await vi.advanceTimersByTimeAsync(2500);
    document.querySelector<HTMLButtonElement>('#pause-timer')!.click(); expect(document.querySelector('#countdown')?.textContent).toContain('남은 1초');
    await vi.advanceTimersByTimeAsync(10_000); expect(fired).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('#pause-timer')!.click(); await flush();
    expect(desktop.scheduleNotification).toHaveBeenLastCalledWith('Quick', 'Quick 쿨타임이 끝났습니다.', 500, 3000);
    await vi.advanceTimersByTimeAsync(499); expect(fired).toHaveLength(0); await vi.advanceTimersByTimeAsync(1); expect(fired).toHaveLength(1); expect(fired[0].at).toBe(Date.parse('2025-01-01T00:00:13.000Z'));
    document.querySelector<HTMLButtonElement>('#stop-timer')!.click(); await vi.advanceTimersByTimeAsync(5000); expect(fired).toHaveLength(1);
  });
  it('mutes, unmutes, resyncs and deletes the running snapshot using real cancellable schedules', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-01T00:00:00Z')); const { fired, canceled } = useMainNotificationScheduler();
    localStorage.setItem(KEY, JSON.stringify(validData({ characters: ['A','B'], selectedCharacter: 'A', skills: [
      { id: id1, name: 'A skill', cooldownSec: 3, reductionPct: 0, characterNames: ['A'] },
      { id: id2, name: 'B skill', cooldownSec: 4, reductionPct: 0, characterNames: ['B'] },
    ], characterCooldownSpecs: [{ characterName: 'A', reductionPct: 0, reductionSec: 0 }, { characterName: 'B', reductionPct: 0, reductionSec: 0 }] })));
    await mount(); document.querySelector<HTMLButtonElement>('#start-timer')!.click(); await flush(); const firstId = await desktop.scheduleNotification.mock.results[0].value.then((v: { id: string }) => v.id);
    const character = document.querySelector<HTMLSelectElement>('#character')!; character.value = 'B'; character.dispatchEvent(new Event('change'));
    expect(document.querySelector<HTMLSelectElement>('#active-skill')!.value).toBe(id2); expect(document.querySelector('#countdown')?.textContent).toContain('A skill');
    document.querySelector<HTMLButtonElement>('#resync-timer')!.click(); await flush(); expect(canceled).toContain(firstId); expect(desktop.scheduleNotification.mock.calls.at(-1)?.[0]).toBe('A skill');
    document.querySelector<HTMLButtonElement>('#mute-timer')!.click(); await vi.advanceTimersByTimeAsync(5000); expect(fired).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('#mute-timer')!.click(); await flush(); const unmuted = await desktop.scheduleNotification.mock.results.at(-1)?.value; await vi.advanceTimersByTimeAsync(3000); expect(fired.at(-1)?.title).toBe('A skill');
    document.querySelector<HTMLButtonElement>('[data-delete-skill="' + id1 + '"]')!.click(); await flush(); expect(canceled).toContain(unmuted.id); const count = fired.length;
    await vi.advanceTimersByTimeAsync(10_000); expect(fired).toHaveLength(count); expect(document.querySelector('#countdown')?.textContent).toContain('중지됨');
    document.querySelector<HTMLButtonElement>('#start-timer')!.click(); await flush(); expect(desktop.scheduleNotification.mock.calls.at(-1)?.[0]).toBe('B skill');
  });
  it('invalidates out-of-order pending schedule replies across mute, unmute, pause and stop', async () => {
    vi.useFakeTimers(); const { scheduler, fired, canceled } = useMainNotificationScheduler();
    let resolvers: Array<() => void> = [];
    desktop.scheduleNotification.mockImplementation((_title: string, _body: string, delay: number, repeat = 0) => new Promise(resolve => {
      resolvers.push(() => resolve(scheduler.schedule(delay, () => fired.push({ title: 'Old or new', at: Date.now() }), repeat)));
    }));
    localStorage.setItem(KEY, JSON.stringify(validData({ skills: [{ id: id1, name: 'Delayed', cooldownSec: 3, reductionPct: 0 }] })));
    await mount(); document.querySelector<HTMLButtonElement>('#start-timer')!.click(); await flush();
    document.querySelector<HTMLButtonElement>('#mute-timer')!.click(); document.querySelector<HTMLButtonElement>('#mute-timer')!.click(); await flush(); expect(resolvers).toHaveLength(2);
    resolvers[1](); await flush(); resolvers[0](); await flush(); expect(canceled).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000); expect(fired).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('#pause-timer')!.click(); document.querySelector<HTMLButtonElement>('#pause-timer')!.click(); await flush(); const beforeStop = resolvers.length;
    document.querySelector<HTMLButtonElement>('#stop-timer')!.click(); resolvers[beforeStop - 1]?.(); await flush();
    await vi.advanceTimersByTimeAsync(10_000); expect(fired).toHaveLength(1); expect(canceled.length).toBeGreaterThanOrEqual(3);
  });
  it.each([
    { frequency: 'weekly', resetWeekday: 1, days: 7, before: '2025-01-12T18:59:59Z', doneAt: '2025-01-05T19:30:00.000Z' },
    { frequency: 'custom', resetWeekday: 1, days: 2, before: '2025-01-03T18:59:59Z', doneAt: '2025-01-01T19:01:00.000Z' },
  ])('refreshes $frequency checkbox at KST reset boundary', async ({ frequency, resetWeekday, days, before, doneAt }) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(before));
    localStorage.setItem(KEY, JSON.stringify(validData({ todos: [{ id: id1, title: frequency, scope: 'account', frequency, resetWeekday, resetTime: '04:00', customDays: days, doneAt }] })));
    await mount(); const checkbox = document.querySelector<HTMLInputElement>('[data-action="toggle"]')!; expect(checkbox.checked).toBe(true);
    vi.advanceTimersByTime(1000); expect(document.querySelector<HTMLInputElement>('[data-action="toggle"]')!.checked).toBe(false);
  });
  it('recalculates daily reset checkbox on timer tick and window focus', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2025-01-03T18:59:59Z'));
    localStorage.setItem(KEY, JSON.stringify(validData({ todos: [{ id: id1, title: 'daily', scope: 'account', frequency: 'daily', resetWeekday: 1, resetTime: '04:00', customDays: 1, doneAt: '2025-01-03T18:30:00.000Z' }] })));
    await mount(); const checkbox = () => document.querySelector<HTMLInputElement>('[data-action="toggle"]')!;
    const focused = checkbox(); focused.focus(); expect(document.activeElement).toBe(focused);
    expect(focused.checked).toBe(true); expect(focused.closest('article')?.classList.contains('done')).toBe(true);
    vi.advanceTimersByTime(1500); expect(checkbox()).toBe(focused); expect(focused.checked).toBe(false); expect(focused.closest('article')?.classList.contains('done')).toBe(false); expect(document.activeElement).toBe(focused);
    vi.setSystemTime(new Date('2025-01-03T18:59:59Z')); window.dispatchEvent(new Event('focus')); expect(checkbox()).toBe(focused); expect(focused.checked).toBe(true); expect(focused.closest('article')?.classList.contains('done')).toBe(true); expect(document.activeElement).toBe(focused);
    document.dispatchEvent(new Event('visibilitychange')); expect(document.activeElement).toBe(focused);
    focused.click(); expect(loadData(localStorage).todos[0].doneAt).toBeUndefined(); expect(checkbox()).toBe(focused);
  });
});
