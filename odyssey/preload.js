'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('odyssey', {
  status: () => ipcRenderer.invoke('status'),
  listGames: () => ipcRenderer.invoke('library:list'),
  scanGames: () => ipcRenderer.invoke('library:scan'),
  cover: (serial) => ipcRenderer.invoke('library:cover', serial),
  addFolder: () => ipcRenderer.invoke('folders:add'),
  removeFolder: (folder) => ipcRenderer.invoke('folders:remove', folder),
  importBios: () => ipcRenderer.invoke('bios:import'),
  openBiosFolder: () => ipcRenderer.invoke('bios:open'),
  setFullscreen: (on) => ipcRenderer.invoke('settings:fullscreen', on),
  chooseEngine: () => ipcRenderer.invoke('settings:engine', false),
  resetEngine: () => ipcRenderer.invoke('settings:engine', true),
  play: (file) => ipcRenderer.invoke('game:play', file),
  reveal: (file) => ipcRenderer.invoke('game:reveal', file),
  engineSettings: () => ipcRenderer.invoke('engine:settings'),
  stop: () => ipcRenderer.invoke('engine:stop'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onEngineState: (cb) => ipcRenderer.on('engine:state', (_e, s) => cb(s)),
  updateState: () => ipcRenderer.invoke('update:state'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
});
