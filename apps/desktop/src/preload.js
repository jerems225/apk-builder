'use strict';
/**
 * Pont entre l'écran de configuration et le processus principal.
 *
 * Surface volontairement minuscule : trois appels, et rien d'autre. La fenêtre
 * charge ensuite une page venue du réseau, qui ne doit disposer d'aucune de ces
 * capacités — d'où `contextIsolation` et l'absence totale de Node côté page.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buildex', {
  configuration: () => ipcRenderer.invoke('buildex:configuration'),
  verifier: (url) => ipcRenderer.invoke('buildex:verifier', url),
  enregistrer: (url) => ipcRenderer.invoke('buildex:enregistrer', url),
});
