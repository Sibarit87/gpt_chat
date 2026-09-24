const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeTheme } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const storage = require("./storage");
const filesApi = require("./files");
const localFiles = require("./local-files");
const { createClient, describeError } = require("./openai-client");
const { DEFAULT_MODEL, MODELS, resolveModel } = require("./models");

let mainWindow = null;
let abortController = null;
let streaming = false;
let settings = { theme: "dark" };

const IMAGE_QUALITY = new Set(["auto", "low", "medium", "high", "xhigh", "max"]);
const IMAGE_SIZE = new Set(["auto", "1024x1024", "1536x1024", "1024x1536"]);
const THEME_BG = { dark: "#121418", light: "#ffffff" };

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return {
      theme: saved.theme === "light" ? "light" : "dark",
    };
  } catch {
    return { theme: "dark" };
  }
}

function saveSettings() {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function applyTheme(theme) {
  settings.theme = theme === "light" ? "light" : "dark";
  saveSettings();
  nativeTheme.themeSource = settings.theme;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(THEME_BG[settings.theme]);
    sendToRenderer("settings:theme", { theme: settings.theme });
  }
}

function buildMenu() {
  const template = [
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          label: "Тема",
          submenu: [
            {
              label: "Тёмная",
              type: "radio",
              checked: settings.theme === "dark",
              click: () => applyTheme("dark"),
            },
            {
              label: "Светлая (ChatGPT)",
              type: "radio",
              checked: settings.theme === "light",
              click: () => applyTheme("light"),
            },
          ],
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveImageQuality(value) {
  return IMAGE_QUALITY.has(value) ? value : "auto";
}

function resolveImageSize(value) {
  return IMAGE_SIZE.has(value) ? value : "auto";
}

function appDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return path.dirname(process.env.PORTABLE_EXECUTABLE_FILE);
  }
  if (app?.isPackaged) {
    return path.dirname(process.execPath);
  }
  return __dirname;
}

function loadEnv() {
  if (process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY.trim();
    return;
  }

  const candidates = [
    path.join(appDir(), ".env"),
    path.join(process.cwd(), ".env"),
    path.join(__dirname, ".env"),
  ];
  const seen = new Set();

  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (seen.has(resolved) || !fs.existsSync(resolved)) continue;
    seen.add(resolved);
    require("dotenv").config({ path: resolved, override: true });
    if (process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY.trim();
      return;
    }
  }
}

loadEnv();

function dataRoot() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "GPT Chat", "data");
}

function legacyDataRoots() {
  const roots = [path.join(__dirname, "data")];
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    roots.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, "data"));
  }
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    roots.push(path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), "data"));
  }
  if (app?.isPackaged) {
    roots.push(path.join(path.dirname(process.execPath), "data"));
  }
  return roots;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: THEME_BG[settings.theme] || THEME_BG.dark,
    title: "GPT Chat",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("dom-ready", () => {
    const theme = settings.theme === "light" ? "light" : "dark";
    mainWindow.webContents.executeJavaScript(
      `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`
    );
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

app.whenReady().then(async () => {
  loadEnv();
  settings = loadSettings();
  nativeTheme.themeSource = settings.theme === "light" ? "light" : "dark";
  buildMenu();
  await storage.migrateChats(dataRoot(), legacyDataRoots());
  if (!process.env.OPENAI_API_KEY) {
    dialog.showErrorBox(
      "Нет ключа OpenAI",
      "Положите файл .env рядом с приложением (или в папку проекта) с строкой:\nOPENAI_API_KEY=sk-..."
    );
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("chats:list", () => storage.listChats(dataRoot()));

ipcMain.handle("chats:get", async (_event, id) => {
  const chat = await storage.getChat(dataRoot(), id);
  const messages = [];
  for (const message of chat.messages || []) {
    const copy = { ...message };
    if (copy.images?.length) {
      copy.previewImages = [];
      for (const image of copy.images) {
        try {
          copy.previewImages.push(await filesApi.readDataUrl(image));
        } catch {
          // skip
        }
      }
    }
    delete copy.images;
    messages.push(copy);
  }
  return {
    ...chat,
    files: (chat.files || []).map(filesApi.publicFile),
    messages,
  };
});

ipcMain.handle("chats:create", async () => {
  const chat = storage.createChat();
  await storage.saveChat(dataRoot(), chat);
  return chat;
});

ipcMain.handle("chats:rename", async (_event, id, title) => {
  const chat = await storage.getChat(dataRoot(), id);
  chat.title = String(title || "").trim() || "Новый чат";
  chat.updatedAt = Date.now();
  await storage.saveChat(dataRoot(), chat);
  return chat;
});

ipcMain.handle("chats:delete", (_event, id) => storage.deleteChat(dataRoot(), id));

ipcMain.handle("chat:stop", () => {
  if (abortController) abortController.abort();
  return true;
});

function buildTools(chat, options) {
  const tools = [];
  if (options.webSearch) tools.push({ type: "web_search" });
  if (options.codeInterpreter) {
    const fileIds = (chat.files || []).filter((file) => file.openaiFileId).map((file) => file.openaiFileId);
    tools.push({
      type: "code_interpreter",
      container: fileIds.length ? { type: "auto", file_ids: fileIds } : { type: "auto" },
    });
  }
  if (options.imageGen) {
    tools.push({
      type: "image_generation",
      quality: resolveImageQuality(options.imageQuality),
      size: resolveImageSize(options.imageSize),
    });
  }
  const docs = (chat.files || []).filter((file) => file.kind === "doc" && chat.vectorStoreId);
  if (docs.length && chat.vectorStoreId) {
    tools.push({ type: "file_search", vector_store_ids: [chat.vectorStoreId] });
  }
  tools.push(...localFiles.FILE_TOOLS);
  return tools;
}

async function toInputMessages(chat, currentUser) {
  const input = [];
  for (const message of chat.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (message.role === "assistant") {
      if (message.content) input.push({ role: "assistant", content: message.content });
      continue;
    }
    const parts = [];
    if (message.content) parts.push({ type: "input_text", text: message.content });
    for (const image of message.images || []) {
      try {
        const dataUrl = await filesApi.readDataUrl(image);
        parts.push({ type: "input_image", image_url: dataUrl });
      } catch {
        // skip missing images
      }
    }
    if (parts.length) input.push({ role: "user", content: parts });
  }
  if (currentUser) input.push(currentUser);
  return input;
}

function collectCitations(response) {
  const citations = [];
  const seen = new Set();
  for (const item of response?.output || []) {
    for (const part of item.content || []) {
      for (const ann of part.annotations || []) {
        if (ann.type === "url_citation" && ann.url && !seen.has(ann.url)) {
          seen.add(ann.url);
          citations.push({ title: ann.title || ann.url, url: ann.url });
        }
      }
    }
  }
  return citations;
}

function parseToolArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return {};
  }
}

function functionCallsFrom(response, fallback) {
  const fromResponse = (response?.output || []).filter((item) => item.type === "function_call");
  return fromResponse.length ? fromResponse : fallback;
}

async function streamModelTurn({ client, model, input, tools, signal, chatId, assistant, previousId, first }) {
  const pendingCalls = [];
  const stream = await client.responses.create(
    {
      model,
      input,
      stream: true,
      store: true,
      ...(first ? { instructions: localFiles.FILE_INSTRUCTIONS } : {}),
      ...(previousId ? { previous_response_id: previousId } : {}),
      ...(tools.length ? { tools } : {}),
    },
    { signal }
  );

  let completed = null;
  for await (const event of stream) {
    const type = event?.type || "";
    if (type === "response.output_text.delta" && event.delta) {
      assistant.content += event.delta;
      sendToRenderer("chat:chunk", { chatId, delta: event.delta });
    } else if (type === "response.web_search_call.searching" || type === "response.web_search_call.in_progress") {
      sendToRenderer("chat:status", { chatId, status: "Ищу в интернете…" });
    } else if (type === "response.file_search_call.searching" || type === "response.file_search_call.in_progress") {
      sendToRenderer("chat:status", { chatId, status: "Смотрю прикреплённые файлы…" });
    } else if (type === "response.code_interpreter_call.in_progress" || type === "response.code_interpreter_call.interpreting") {
      sendToRenderer("chat:status", { chatId, status: "Считаю в песочнице…" });
    } else if (type === "response.image_generation_call.generating" || type === "response.image_generation_call.in_progress") {
      sendToRenderer("chat:status", { chatId, status: "Рисую картинку…" });
    } else if (type === "response.output_item.done" && event.item?.type === "image_generation_call" && event.item.result) {
      assistant.images.push(`data:image/png;base64,${event.item.result}`);
      sendToRenderer("chat:image", { chatId, dataUrl: assistant.images[assistant.images.length - 1] });
    } else if (type === "response.output_item.done" && event.item?.type === "function_call") {
      pendingCalls.push(event.item);
      sendToRenderer("chat:status", { chatId, status: "Работаю с файлами…" });
    } else if (type === "response.completed") {
      completed = event.response;
      assistant.citations = collectCitations(event.response);
      if (!assistant.content && event.response?.output_text) {
        assistant.content = event.response.output_text;
      }
    }
  }

  return {
    response: completed,
    calls: functionCallsFrom(completed, pendingCalls),
  };
}

ipcMain.handle("models:list", () => ({ defaultModel: DEFAULT_MODEL, models: MODELS }));

ipcMain.handle("settings:theme", () => settings.theme);

ipcMain.handle("files:attach", async (_event, chatId, payload) => {
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: "Нет ключа OpenAI" };
  const root = dataRoot();
  const chat = await storage.getChat(root, chatId);
  try {
    const file = await filesApi.attachFile(createClient(process.env.OPENAI_API_KEY), root, chat, payload);
    await storage.saveChat(root, chat);
    return { ok: true, file, files: (chat.files || []).map(filesApi.publicFile) };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
});

ipcMain.handle("files:remove", async (_event, chatId, fileId) => {
  const root = dataRoot();
  const chat = await storage.getChat(root, chatId);
  await filesApi.removeFile(createClient(process.env.OPENAI_API_KEY), chat, fileId);
  await storage.saveChat(root, chat);
  return { ok: true, files: (chat.files || []).map(filesApi.publicFile) };
});

ipcMain.handle("chat:send", async (_event, chatId, content, options = {}) => {
  const text = String(content || "").trim();
  if (!text) return { ok: false, error: "Пустое сообщение" };
  if (streaming) return { ok: false, error: "Уже идёт ответ" };
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "Нет OPENAI_API_KEY в файле .env" };
  }

  const model = resolveModel(options.model);
  const root = dataRoot();
  const chat = await storage.getChat(root, chatId);
  const imageFiles = (chat.files || []).filter((file) => file.kind === "image");
  chat.messages.push({
    role: "user",
    content: text,
    images: imageFiles.map((file) => ({
      localPath: file.localPath,
      mime: file.mime,
      name: file.name,
    })),
  });
  chat.files = (chat.files || []).filter((file) => file.kind !== "image");
  if (chat.messages.filter((message) => message.role === "user").length === 1) {
    chat.title = storage.titleFromMessage(text);
  }
  chat.updatedAt = Date.now();
  await storage.saveChat(root, chat);

  streaming = true;
  abortController = new AbortController();

  const client = createClient(process.env.OPENAI_API_KEY);
  const assistant = {
    role: "assistant",
    content: "",
    model,
    citations: [],
    images: [],
    fileOps: [],
    used: {
      webSearch: Boolean(options.webSearch),
      codeInterpreter: Boolean(options.codeInterpreter),
      imageGen: Boolean(options.imageGen),
    },
  };
  const tools = buildTools(chat, {
    webSearch: Boolean(options.webSearch),
    codeInterpreter: Boolean(options.codeInterpreter),
    imageGen: Boolean(options.imageGen),
    imageQuality: options.imageQuality,
    imageSize: options.imageSize,
  });

  try {
    let input = await toInputMessages(chat);
    let previousId;
    for (let step = 0; step < 8; step += 1) {
      const turn = await streamModelTurn({
        client,
        model,
        input,
        tools,
        signal: abortController.signal,
        chatId,
        assistant,
        previousId,
        first: step === 0,
      });
      previousId = turn.response?.id;
      const calls = turn.calls || [];
      if (!calls.length) break;

      input = [];
      for (const call of calls) {
        const result = await localFiles.execute(call.name, parseToolArgs(call.arguments));
        if (result.op) assistant.fileOps.push(result.op);
        sendToRenderer("chat:status", { chatId, status: result.status });
        if (result.op) sendToRenderer("chat:file", { chatId, op: result.op });
        input.push({
          type: "function_call_output",
          call_id: call.call_id || call.id,
          output: JSON.stringify(result.payload),
        });
      }
    }

    chat.messages.push(assistant);
    chat.updatedAt = Date.now();
    await storage.saveChat(root, chat);
    sendToRenderer("chat:done", {
      chatId,
      content: assistant.content,
      title: chat.title,
      model,
      citations: assistant.citations,
      images: assistant.images,
      fileOps: assistant.fileOps,
    });
    return { ok: true, title: chat.title, model };
  } catch (err) {
    const aborted = err?.name === "AbortError" || abortController.signal.aborted;
    if (aborted) {
      if (assistant.content || assistant.images.length || assistant.fileOps.length) {
        chat.messages.push(assistant);
        chat.updatedAt = Date.now();
        await storage.saveChat(root, chat);
      }
      sendToRenderer("chat:done", {
        chatId,
        content: assistant.content,
        title: chat.title,
        model,
        citations: assistant.citations,
        images: assistant.images,
        fileOps: assistant.fileOps,
        stopped: true,
      });
      return { ok: true, stopped: true, title: chat.title, model };
    }

    const message = describeError(err);
    sendToRenderer("chat:error", { chatId, error: message });
    return { ok: false, error: message };
  } finally {
    streaming = false;
    abortController = null;
  }
});
