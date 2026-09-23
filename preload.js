const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatApi", {
  listChats: () => ipcRenderer.invoke("chats:list"),
  getChat: (id) => ipcRenderer.invoke("chats:get", id),
  createChat: () => ipcRenderer.invoke("chats:create"),
  renameChat: (id, title) => ipcRenderer.invoke("chats:rename", id, title),
  deleteChat: (id) => ipcRenderer.invoke("chats:delete", id),
  getModels: () => ipcRenderer.invoke("models:list"),
  attachFile: (chatId, payload) => ipcRenderer.invoke("files:attach", chatId, payload),
  removeFile: (chatId, fileId) => ipcRenderer.invoke("files:remove", chatId, fileId),
  sendMessage: (chatId, content, options) => ipcRenderer.invoke("chat:send", chatId, content, options),
  stop: () => ipcRenderer.invoke("chat:stop"),
  onChunk: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on("chat:chunk", listener);
    return () => ipcRenderer.removeListener("chat:chunk", listener);
  },
  onStatus: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on("chat:status", listener);
    return () => ipcRenderer.removeListener("chat:status", listener);
  },
  onImage: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on("chat:image", listener);
    return () => ipcRenderer.removeListener("chat:image", listener);
  },
  onDone: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on("chat:done", listener);
    return () => ipcRenderer.removeListener("chat:done", listener);
  },
  onError: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on("chat:error", listener);
    return () => ipcRenderer.removeListener("chat:error", listener);
  },
});
