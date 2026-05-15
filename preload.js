const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smmtApi', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (partialSettings) => ipcRenderer.invoke('settings:save', partialSettings),
  pickSaveDirectory: (currentPath) => ipcRenderer.invoke('settings:pick-save-directory', currentPath),
  clearBackgroundCache: () => ipcRenderer.invoke('cache:clear-background'),
  runDownload: (payload) => ipcRenderer.invoke('download:run', payload),
});
