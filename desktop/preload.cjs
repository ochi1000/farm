const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phoneRelay', {
  onSimulationEvent: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('simulation-event', listener);
    return () => ipcRenderer.removeListener('simulation-event', listener);
  },
  runAction: (action, options) => ipcRenderer.invoke('run-action', action, options),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  viewerInput: input => ipcRenderer.send('viewer-input', input),
  onViewerEvent: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('viewer-event', listener);
    return () => ipcRenderer.removeListener('viewer-event', listener);
  }
});
