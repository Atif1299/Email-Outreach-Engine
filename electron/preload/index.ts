import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld('outreach', {
  openImportDialog: () => ipcRenderer.invoke('outreach:openImportDialog'),
  parsePreview: (filePath: string) => ipcRenderer.invoke('outreach:parsePreview', filePath),
  importCommit: (payload: { filePath: string; mapping: Record<string, string> }) =>
    ipcRenderer.invoke('outreach:importCommit', payload),
  importBatchesList: () => ipcRenderer.invoke('outreach:importBatchesList'),
  importBatchDelete: (batchId: number) => ipcRenderer.invoke('outreach:importBatchDelete', batchId),
  leadIdsForCampaign: (campaignId: number) =>
    ipcRenderer.invoke('outreach:leadIdsForCampaign', campaignId),
  leadsList: (arg?: string | { search?: string; importBatchId?: number }) =>
    ipcRenderer.invoke('outreach:leadsList', arg),
  leadDelete: (id: number) => ipcRenderer.invoke('outreach:leadDelete', id),
  campaignsList: () => ipcRenderer.invoke('outreach:campaignsList'),
  campaignSave: (payload: unknown) => ipcRenderer.invoke('outreach:campaignSave', payload),
  campaignGet: (id: number) => ipcRenderer.invoke('outreach:campaignGet', id),
  campaignDelete: (id: number) => ipcRenderer.invoke('outreach:campaignDelete', id),
  settingsGet: () => ipcRenderer.invoke('outreach:settingsGet'),
  settingsSave: (payload: unknown) => ipcRenderer.invoke('outreach:settingsSave', payload),
  smtpTest: (payload: { testAddress: string; smtpPassword?: string }) =>
    ipcRenderer.invoke('outreach:smtpTest', payload),
  preview: (req: unknown) => ipcRenderer.invoke('outreach:preview', req),
  aiGenerate: (req: unknown) => ipcRenderer.invoke('outreach:aiGenerate', req),
  applyAiBodyOverrides: (payload: unknown) =>
    ipcRenderer.invoke('outreach:applyAiBodyOverrides', payload),
  clearStepBodyOverrides: (payload: { campaignId: number; stepOrder: number }) =>
    ipcRenderer.invoke('outreach:clearStepBodyOverrides', payload),
  listStepSavedContent: (payload: { campaignId: number; stepOrder: number }) =>
    ipcRenderer.invoke('outreach:listStepSavedContent', payload),
  saveMergePreview: (payload: {
    leadId: number
    campaignId: number
    stepOrder: number
    previewText: string
  }) => ipcRenderer.invoke('outreach:saveMergePreview', payload),
  queueStart: (payload: { campaignId: number; leadIds: number[] }) =>
    ipcRenderer.invoke('outreach:queueStart', payload),
  queuePause: () => ipcRenderer.invoke('outreach:queuePause'),
  queueResume: () => ipcRenderer.invoke('outreach:queueResume'),
  queueStop: () => ipcRenderer.invoke('outreach:queueStop'),
  queueStatus: () => ipcRenderer.invoke('outreach:queueStatus'),
  campaignSendProgress: (campaignId: number) =>
    ipcRenderer.invoke('outreach:campaignSendProgress', campaignId),
  campaignsSendProgressList: () => ipcRenderer.invoke('outreach:campaignsSendProgressList'),
  computeDue: (payload: { campaignId: number; leadIds: number[] }) =>
    ipcRenderer.invoke('outreach:computeDue', payload),
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)