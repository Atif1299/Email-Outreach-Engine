const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Import
  openImportDialog: () => ipcRenderer.invoke('openImportDialog'),
  parsePreview: (filePath) => ipcRenderer.invoke('parsePreview', filePath),
  importCommit: (payload) => ipcRenderer.invoke('importCommit', payload),

  // Batches
  batchesList: () => ipcRenderer.invoke('batchesList'),
  batchDelete: (batchId) => ipcRenderer.invoke('batchDelete', batchId),

  // Leads
  leadsList: (opts) => ipcRenderer.invoke('leadsList', opts),
  leadsVerificationStats: (opts) => ipcRenderer.invoke('leadsVerificationStats', opts),
  leadDelete: (id) => ipcRenderer.invoke('leadDelete', id),
  leadIdsForCampaign: (campaignId) => ipcRenderer.invoke('leadIdsForCampaign', campaignId),
  verifyBatch: (payload) => ipcRenderer.invoke('verifyBatch', payload),
  verifyLeads: (payload) => ipcRenderer.invoke('verifyLeads', payload),
  campaignLeadVerificationStats: (campaignId) => ipcRenderer.invoke('campaignLeadVerificationStats', campaignId),

  // Campaigns
  campaignsList: () => ipcRenderer.invoke('campaignsList'),
  campaignGet: (id) => ipcRenderer.invoke('campaignGet', id),
  campaignSave: (payload) => ipcRenderer.invoke('campaignSave', payload),
  generatePitchBlock: (payload) => ipcRenderer.invoke('generatePitchBlock', payload),
  campaignDelete: (id) => ipcRenderer.invoke('campaignDelete', id),
  campaignSendProgress: (campaignId) => ipcRenderer.invoke('campaignSendProgress', campaignId),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settingsGet'),
  settingsSave: (payload) => ipcRenderer.invoke('settingsSave', payload),
  smtpTest: (payload) => ipcRenderer.invoke('smtpTest', payload),

  // Preview / AI
  preview: (req) => ipcRenderer.invoke('preview', req),
  aiGenerate: (req) => ipcRenderer.invoke('aiGenerate', req),
  applyBodyOverrides: (payload) => ipcRenderer.invoke('applyBodyOverrides', payload),
  clearStepOverrides: (payload) => ipcRenderer.invoke('clearStepOverrides', payload),
  listStepSavedContent: (payload) => ipcRenderer.invoke('listStepSavedContent', payload),
  saveMergePreview: (payload) => ipcRenderer.invoke('saveMergePreview', payload),

  // Queue
  queueStart: (payload) => ipcRenderer.invoke('queueStart', payload),
  queuePause: () => ipcRenderer.invoke('queuePause'),
  queueResume: () => ipcRenderer.invoke('queueResume'),
  queueStop: () => ipcRenderer.invoke('queueStop'),
  queueStatus: () => ipcRenderer.invoke('queueStatus'),
  computeDue: (payload) => ipcRenderer.invoke('computeDue', payload),

  // Queue status events
  onQueueStatus: (callback) => {
    ipcRenderer.on('queue:status', (_, data) => callback(data))
  },

  onVerifyProgress: (callback) => {
    ipcRenderer.on('verify:progress', (_, data) => callback(data))
  }
})
