const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  getBooks: (args) => ipcRenderer.invoke('scripture:books', args),
  getChapter: (args) => ipcRenderer.invoke('scripture:chapter', args),
  speak: (args) => ipcRenderer.invoke('tts:speak', args),
});
