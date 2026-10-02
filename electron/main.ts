import { app, BrowserWindow, desktopCapturer, ipcMain, Notification, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowedPermissionRequest, CaptureSourceGate, NotificationScheduler, trustedCaptureOrigin, trustedEditorSender, trustedPageUrl, validNotificationPayload } from './security';

let editor: BrowserWindow | null = null;
let observer: BrowserWindow | null = null;
const smokeFileLoad = process.argv.includes('--smoke-file-load');
const dev = !app.isPackaged && !smokeFileLoad;
const smokeTest = process.argv.includes('--smoke-test');
const devUrl = 'http://127.0.0.1:5173/';
const editorFileUrl = pathToFileURL(path.resolve(__dirname, '../dist/index.html')).href;
const observerDevUrl = `${devUrl}?observer=1`;
const observerFileUrl = `${editorFileUrl}?observer=1`;
const captureSources = new CaptureSourceGate<Electron.DesktopCapturerSource>();
const notifications = new NotificationScheduler();
const notificationTitles = new Map<string, { title: string; body: string }>();
let smokeNotificationFinished: ((shown: boolean) => void) | null = null;
const editorAllowed = (event: Electron.IpcMainInvokeEvent) => trustedEditorSender(event, editor?.webContents ?? null, devUrl, editorFileUrl);
const isTrustedEditorWebContents = (contents: Electron.WebContents, frame: Electron.WebFrameMain | null, url: string) =>
  Boolean(editor && contents === editor.webContents && frame && frame === editor.webContents.mainFrame && trustedPageUrl(frame.url, url));

function hardenNavigation(window: BrowserWindow, allowedUrl: () => string) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!trustedPageUrl(url, allowedUrl())) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!trustedPageUrl(url, allowedUrl())) event.preventDefault(); });
}
function createEditor() {
  editor = new BrowserWindow({ width: 1080, height: 820, minWidth: 760, minHeight: 620, backgroundColor: '#111722', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  hardenNavigation(editor, () => dev ? devUrl : editorFileUrl);
  editor.webContents.once('did-finish-load', () => { console.log('MAPLE_EDITOR_READY'); if (smokeTest) void runStartupSmoke(); });
  if (dev) void editor.loadURL(devUrl); else void editor.loadFile(path.join(__dirname, '../dist/index.html'));
  editor.on('closed', () => { editor = null; captureSources.clear(); closeObserver(); });
}
function closeObserver() { if (observer && !observer.isDestroyed()) observer.close(); observer = null; }
function openObserver() {
  if (observer && !observer.isDestroyed()) { observer.showInactive(); return; }
  observer = new BrowserWindow({ width: 480, height: 270, minWidth: 240, minHeight: 140, frame: false, resizable: true, alwaysOnTop: true, focusable: false, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  hardenNavigation(observer, () => dev ? observerDevUrl : observerFileUrl);
  if (smokeTest) observer.webContents.once('did-finish-load', () => { void verifyObserverSmoke(); });
  if (dev) void observer.loadURL(observerDevUrl); else void observer.loadFile(path.join(__dirname, '../dist/index.html'), { query: { observer: '1' } });
  observer.on('closed', () => { observer = null; });
}
function setupIpc() {
  ipcMain.handle('capture:list', async event => {
    if (!editorAllowed(event)) throw new Error('허용되지 않은 호출입니다.');
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
    captureSources.replace(sources.map(source => ({ id: source.id, source })));
    return sources.map(({ id, name }) => ({ id, name: name.slice(0, 160) }));
  });
  ipcMain.handle('capture:select', (event, id: unknown) => {
    if (!editorAllowed(event)) throw new Error('허용되지 않은 호출입니다.');
    if (id === '') { captureSources.select(''); return true; }
    return captureSources.select(id);
  });
  ipcMain.handle('observer:open', event => { if (!editorAllowed(event)) throw new Error('허용되지 않은 호출입니다.'); openObserver(); return true; });
  ipcMain.handle('observer:frame', (event, dataUrl: unknown) => {
    if (!editorAllowed(event)) throw new Error('허용되지 않은 호출입니다.');
    if (typeof dataUrl !== 'string' || dataUrl.length > 350_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('프레임 데이터가 올바르지 않습니다.');
    if (observer && !observer.isDestroyed() && isTrustedObserver(observer.webContents)) observer.webContents.send('observer:frame-data', dataUrl);
    return true;
  });
  ipcMain.handle('observer:close', event => { if (!editorAllowed(event)) throw new Error('허용되지 않은 호출입니다.'); closeObserver(); return true; });
  ipcMain.handle('notification:schedule', (event, title: unknown, body: unknown, delayMs: unknown, repeatMs: unknown) => {
    if (!editorAllowed(event)) throw new Error('허용되지 않은 호출입니다.');
    if (!validNotificationPayload(title, body) || typeof delayMs !== 'number' || !Number.isInteger(delayMs) || delayMs < 1 || delayMs > 86_400_000 || typeof repeatMs !== 'number' || !Number.isInteger(repeatMs) || repeatMs < 0 || repeatMs > 86_400_000 || (repeatMs !== 0 && repeatMs < 1) || notificationTitles.size >= 32 || !Notification.isSupported()) return null;
    let scheduled: { id: string; scheduledAt: number };
    scheduled = notifications.schedule(delayMs, () => {
      const message = notificationTitles.get(scheduled.id);
      if (!message || !Notification.isSupported()) return;
      let shown = false;
      try { const notification = new Notification(message); notification.show(); shown = true; } catch { /* Native notifications can be unavailable or denied by the OS. */ }
      if (repeatMs === 0) notificationTitles.delete(scheduled.id);
      if (smokeNotificationFinished) { console.log('MAPLE_NOTIFICATION_EXPIRED', shown); smokeNotificationFinished(shown); smokeNotificationFinished = null; }
    }, repeatMs);
    notificationTitles.set(scheduled.id, { title, body: body as string });
    return scheduled;
  });
  ipcMain.handle('notification:cancel', (event, id: unknown) => {
    if (!editorAllowed(event)) throw new Error('허용되지 않은 호출입니다.');
    if (typeof id !== 'string') return false;
    notifications.cancel(id); notificationTitles.delete(id); return true;
  });
}
function isTrustedObserver(contents: Electron.WebContents) {
  return Boolean(observer && contents === observer.webContents && trustedPageUrl(contents.mainFrame.url, dev ? observerDevUrl : observerFileUrl));
}
async function runStartupSmoke() {
  try {
    if (!editor) throw new Error('editor 창이 없습니다.');
    const editorReady = await editor.webContents.executeJavaScript("Boolean(document.querySelector('#app h1')?.textContent && getComputedStyle(document.body).backgroundColor === 'rgb(17, 23, 34)')");
    if (!editorReady) throw new Error('editor JS/CSS startup을 확인하지 못했습니다.');
    if (editor.webContents.getURL() !== (dev ? devUrl : editorFileUrl)) throw new Error('editor가 허용된 URL에서 실행되지 않았습니다.');
    if (process.argv.includes('--smoke-navigation')) await smokeNavigation();
    if (process.argv.includes('--smoke-capture')) await smokeCapture();
    if (process.argv.includes('--smoke-notification')) await smokeHiddenNotification();
    openObserver();
  } catch (error) { console.error('MAPLE_STARTUP_FAILED', error instanceof Error ? error.message : String(error)); app.exit(1); }
}
async function smokeNavigation() {
  if (!editor) throw new Error('navigation smoke 실행 시 editor 창이 없습니다.');
  const anchors = ['timer', 'todos', 'pip', 'data'];
  for (const id of anchors) {
    const clickedUrl = await editor.webContents.executeJavaScript(`(() => { document.querySelector('nav a[href="#${id}"]').click(); return location.href; })()`, true);
    const trustedUrl = dev ? devUrl : editorFileUrl;
    if (clickedUrl !== trustedUrl || editor.webContents.getURL() !== trustedUrl) throw new Error(`내부 navigation이 trust URL을 변경했습니다: #${id}`);
    const sources = await editor.webContents.executeJavaScript('window.desktop.listSources()') as Array<{ id: string }>;
    if (!sources.length) throw new Error(`내부 navigation 후 capture source 목록이 비었습니다: #${id}`);
    const selected = await editor.webContents.executeJavaScript(`window.desktop.selectSource(${JSON.stringify(sources[0].id)})`);
    if (!selected) throw new Error(`내부 navigation 후 source 선택 IPC 실패: #${id}`);
    const capture = await editor.webContents.executeJavaScript("navigator.mediaDevices.getDisplayMedia({ audio: false, video: true }).then(stream => { const tracks = stream.getTracks(); const started = tracks.some(track => track.readyState === 'live'); tracks.forEach(track => track.stop()); return { ok: started && tracks.every(track => track.readyState === 'ended') }; }).catch(error => ({ ok: false, message: String(error?.message ?? error) }))", true) as { ok: boolean; message?: string };
    if (!capture.ok) throw new Error(`내부 navigation 후 capture start/stop 실패 (#${id}): ${capture.message}`);
    const canceled = await editor.webContents.executeJavaScript("window.desktop.scheduleNotification('Navigation smoke', 'IPC verification', 30000).then(async scheduled => scheduled ? window.desktop.cancelNotification(scheduled.id) : false)");
    if (!canceled) throw new Error(`내부 navigation 후 notification schedule/cancel IPC 실패: #${id}`);
    console.log('MAPLE_NAV_IPC_OK', `#${id}`);
  }
}
async function smokeHiddenNotification() {
  if (!editor) throw new Error('notification smoke 실행 시 editor 창이 없습니다.');
  const id = await editor.webContents.executeJavaScript("window.desktop.scheduleNotification('테스트 알림', '숨김 창 알림 확인', 1000)");
  if (!id) throw new Error('main process native notification을 예약할 수 없습니다.');
  editor.hide();
  const shown = await new Promise<boolean>(resolve => {
    const timeout = setTimeout(() => resolve(false), 5000);
    smokeNotificationFinished = result => { clearTimeout(timeout); resolve(result); };
  });
  smokeNotificationFinished = null;
  if (!shown) throw new Error('숨긴 editor의 timer 만료 후 native notification 표시 호출을 확인하지 못했습니다.');
  console.log('MAPLE_HIDDEN_NOTIFICATION_READY');
}
async function smokeCapture() {
  if (!editor) throw new Error('capture smoke 실행 시 editor 창이 없습니다.');
  let sources: Electron.DesktopCapturerSource[];
  console.log('MAPLE_CAPTURE_SOURCE_LIST_REQUESTED');
  try { sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); }
  catch { throw new Error('desktopCapturer.getSources가 이 호스트 런타임에서 거부되었습니다. OS 화면 캡처 권한/세션을 확인하세요.'); }
  if (!sources.length) throw new Error('OS에서 캡처 가능한 화면을 제공하지 않았습니다.');
  console.log('MAPLE_CAPTURE_SOURCE_LIST_READY');
  captureSources.replace(sources.map(source => ({ id: source.id, source })));
  const selected = await editor.webContents.executeJavaScript(`window.desktop.selectSource(${JSON.stringify(sources[0].id)})`);
  if (!selected) throw new Error('trusted editor IPC에서 화면 소스 선택에 실패했습니다.');
  console.log('MAPLE_CAPTURE_SOURCE_SELECTED');
  const result = await editor.webContents.executeJavaScript("navigator.mediaDevices.getDisplayMedia({ audio: false, video: true }).then(stream => { const track = stream.getVideoTracks()[0]; const size = track?.getSettings(); stream.getTracks().forEach(item => item.stop()); return { ok: Boolean(track && size) }; }).catch(error => ({ ok: false, name: String(error?.name ?? 'Error'), message: String(error?.message ?? error) }))", true) as { ok: boolean; name?: string; message?: string };
  if (!result.ok) throw new Error(`Electron getDisplayMedia failed (${result.name}): ${result.message}`);
  console.log('MAPLE_CAPTURE_STREAM_READY');
  captureSources.clear(); console.log('MAPLE_CAPTURE_STARTED_AND_STOPPED');
}
async function verifyObserverSmoke() {
  try {
    if (!observer) throw new Error('observer 창이 없습니다.');
    const ready = await observer.webContents.executeJavaScript("Boolean(document.querySelector('.observer img') && getComputedStyle(document.body).backgroundColor === 'rgb(6, 9, 14)')");
    if (!ready) throw new Error('observer JS/CSS startup을 확인하지 못했습니다.');
    console.log('MAPLE_OBSERVER_READY'); closeObserver(); app.quit();
  } catch (error) { console.error('MAPLE_OBSERVER_FAILED', error instanceof Error ? error.message : String(error)); app.exit(1); }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const expectedUrl = dev ? devUrl : editorFileUrl;
    const trusted = isTrustedEditorWebContents(contents, contents.mainFrame, expectedUrl) && details.isMainFrame && trustedPageUrl(details.requestingUrl, expectedUrl);
    const media = details as Electron.MediaAccessPermissionRequest;
    const originOk = permission !== 'media' || trustedCaptureOrigin(media.securityOrigin ?? '', expectedUrl);
    const allowed = allowedPermissionRequest(permission, trusted && originOk, captureSources.hasSelection, media.mediaTypes);
    if (process.argv.includes('--smoke-capture') || process.argv.includes('--smoke-navigation')) console.log('MAPLE_PERMISSION_REQUEST', permission, trusted, originOk, captureSources.hasSelection, media.mediaTypes, details);
    callback(allowed);
  });
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const expectedUrl = dev ? devUrl : editorFileUrl;
    const originOk = trustedCaptureOrigin(request.securityOrigin, expectedUrl);
    const trusted = Boolean(editor && request.frame && isTrustedEditorWebContents(editor.webContents, request.frame, expectedUrl) && originOk && trustedPageUrl(request.frame.url, expectedUrl));
    if (process.argv.includes('--smoke-capture') || process.argv.includes('--smoke-navigation')) console.log('MAPLE_DISPLAY_REQUEST', trusted, request.userGesture, request.videoRequested, request.audioRequested, originOk, request.securityOrigin, request.frame?.url);
    const source = captureSources.grant({ trusted, userGesture: request.userGesture, videoRequested: request.videoRequested, audioRequested: request.audioRequested });
    callback(source ? { video: source } : {});
  });
  setupIpc();
  createEditor();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { notifications.clear(); notificationTitles.clear(); captureSources.clear(); closeObserver(); });
