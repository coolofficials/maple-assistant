import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  listSources: () => ipcRenderer.invoke('capture:list'),
  selectSource: (id: string) => ipcRenderer.invoke('capture:select', id),
  openObserver: () => ipcRenderer.invoke('observer:open'),
  publishFrame: (dataUrl: string) => ipcRenderer.invoke('observer:frame', dataUrl),
  closeObserver: () => ipcRenderer.invoke('observer:close'),
  scheduleNotification: (title: string, body: string, delayMs: number, repeatMs = 0) => ipcRenderer.invoke('notification:schedule', title, body, delayMs, repeatMs),
  cancelNotification: (id: string) => ipcRenderer.invoke('notification:cancel', id),
  onFrame: (callback: (dataUrl: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, dataUrl: string) => callback(dataUrl);
    ipcRenderer.on('observer:frame-data', listener);
    return () => ipcRenderer.removeListener('observer:frame-data', listener);
  },
});
