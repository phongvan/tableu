'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  conn: {
    list: () => invoke('conn:list'),
    save: (cfg) => invoke('conn:save', cfg),
    remove: (id) => invoke('conn:delete', id),
    test: (cfg) => invoke('conn:test', cfg),
    disconnect: (id) => invoke('db:disconnect', id),
  },
  db: {
    databases: (connId) => invoke('db:databases', connId),
    tables: (connId, database) => invoke('db:tables', connId, database),
    columns: (connId, database, table) => invoke('db:columns', connId, database, table),
    indexes: (connId, database, table) => invoke('db:indexes', connId, database, table),
    ddl: (connId, database, table) => invoke('db:ddl', connId, database, table),
    rows: (connId, database, table, opts) => invoke('db:rows', connId, database, table, opts),
    query: (connId, database, sql, maxRows) => invoke('db:query', connId, database, sql, maxRows),
    schema: (connId, database) => invoke('db:schema', connId, database),
    updateCell: (connId, database, table, keyValues, column, value) =>
      invoke('db:updateCell', connId, database, table, keyValues, column, value),
    deleteRow: (connId, database, table, keyValues) =>
      invoke('db:deleteRow', connId, database, table, keyValues),
  },
  appInfo: () => invoke('app:info'),
  moLienKet: (url) => invoke('app:openExternal', url),
  exportCsv: (name, csv) => invoke('export:csv', name, csv),
  onMenu: (channel, cb) => {
    const listener = () => cb();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
