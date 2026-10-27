const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  getChapter: (args) => ipcRenderer.invoke('scripture:chapter', args),
  speak: (args) => ipcRenderer.invoke('tts:speak', args),
});
