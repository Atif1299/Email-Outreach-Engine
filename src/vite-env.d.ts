/// <reference types="vite/client" />

interface Window {
  ipcRenderer: import('electron').IpcRenderer
  outreach: import('./lib/outreachApi').OutreachApi
}
