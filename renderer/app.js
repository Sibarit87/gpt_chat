const chatListEl = document.getElementById("chatList");
const dialogEl = document.getElementById("dialog");
const messagesEl = document.getElementById("messages");
const emptyStateEl = document.getElementById("emptyState");
const emptyTitleEl = document.getElementById("emptyTitle");
const emptyTextEl = document.getElementById("emptyText");
const chatTitleEl = document.getElementById("chatTitle");
const headerActions = document.getElementById("headerActions");
const renameChatBtn = document.getElementById("renameChatBtn");
const contextSizeEl = document.getElementById("contextSize");
const newChatBtn = document.getElementById("newChatBtn");
const deleteChatBtn = document.getElementById("deleteChatBtn");
const composer = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const stopBtn = document.getElementById("stopBtn");
const modelSelect = document.getElementById("modelSelect");
const reasoningSelect = document.getElementById("reasoningSelect");
const webSearchBtn = document.getElementById("webSearchBtn");
const codeBtn = document.getElementById("codeBtn");
const imageBtn = document.getElementById("imageBtn");
const imageOptions = document.getElementById("imageOptions");
const imageQuality = document.getElementById("imageQuality");
const imageSize = document.getElementById("imageSize");
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const attachList = document.getElementById("attachList");

const MODEL_STORAGE_KEY = "gpt-chat.model";
const REASONING_STORAGE_KEY = "gpt-chat.reasoning";
const IMAGE_QUALITY_KEY = "gpt-chat.imageQuality";
const IMAGE_SIZE_KEY = "gpt-chat.imageSize";
const IMAGE_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"];
const IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"];
const TOOL_KEYS = {
  webSearch: "gpt-chat.webSearch",
  codeInterpreter: "gpt-chat.code",
  imageGen: "gpt-chat.image",
};

let chats = [];
let currentId = null;
let streaming = false;
let assistantEl = null;
let models = [];
let reasoningEfforts = [];
let defaultModel = "gpt-6-luna";
let defaultReasoning = "low";
let currentFiles = [];

function modelLabel(id) {
  return models.find((model) => model.id === id)?.label || id || "";
}

function reasoningLabel(id) {
  return reasoningEfforts.find((item) => item.id === id)?.label || "";
}

function selectedModel() {
  return modelSelect.value || defaultModel;
}

function fillModels(catalog) {
  models = catalog.models || [];
  defaultModel = catalog.defaultModel || defaultModel;
  const saved = localStorage.getItem(MODEL_STORAGE_KEY);
  const current = models.some((model) => model.id === saved) ? saved : defaultModel;
  modelSelect.innerHTML = "";
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.hint ? `${model.label} — ${model.hint}` : model.label;
    modelSelect.appendChild(option);
  }
  modelSelect.value = current;
}

function fillReasoning(catalog) {
  reasoningEfforts = catalog.reasoningEfforts || [];
  defaultReasoning = catalog.defaultReasoning || defaultReasoning;
  const saved = localStorage.getItem(REASONING_STORAGE_KEY);
  const current = reasoningEfforts.some((item) => item.id === saved) ? saved : defaultReasoning;
  reasoningSelect.innerHTML = "";
  for (const item of reasoningEfforts) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    if (item.hint) option.title = item.hint;
    reasoningSelect.appendChild(option);
  }
  if (reasoningEfforts.length) reasoningSelect.value = current;
}

modelSelect.addEventListener("change", () => {
  localStorage.setItem(MODEL_STORAGE_KEY, modelSelect.value);
});

reasoningSelect.addEventListener("change", () => {
  localStorage.setItem(REASONING_STORAGE_KEY, reasoningSelect.value);
});

function toolOn(key) {
  return localStorage.getItem(TOOL_KEYS[key]) === "1";
}

function setTool(key, on) {
  localStorage.setItem(TOOL_KEYS[key], on ? "1" : "0");
}

function syncToolButtons() {
  webSearchBtn.classList.toggle("active", toolOn("webSearch"));
  codeBtn.classList.toggle("active", toolOn("codeInterpreter"));
  imageBtn.classList.toggle("active", toolOn("imageGen"));
  imageOptions.classList.toggle("hidden", !toolOn("imageGen"));
}

function bindTool(button, key) {
  button.addEventListener("click", () => {
    setTool(key, !toolOn(key));
    syncToolButtons();
  });
}

function storedChoice(key, allowed, fallback) {
  const saved = localStorage.getItem(key);
  return allowed.includes(saved) ? saved : fallback;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

imageQuality.value = storedChoice(IMAGE_QUALITY_KEY, IMAGE_QUALITIES, "auto");
imageSize.value = storedChoice(IMAGE_SIZE_KEY, IMAGE_SIZES, "auto");
imageQuality.addEventListener("change", () => {
  localStorage.setItem(IMAGE_QUALITY_KEY, imageQuality.value);
});
imageSize.addEventListener("change", () => {
  localStorage.setItem(IMAGE_SIZE_KEY, imageSize.value);
});

bindTool(webSearchBtn, "webSearch");
bindTool(codeBtn, "codeInterpreter");
bindTool(imageBtn, "imageGen");
syncToolButtons();

function renderFiles() {
  attachList.innerHTML = "";
  for (const file of currentFiles) {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    const label = document.createElement("span");
    label.textContent = file.name;
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "×";
    del.addEventListener("click", async () => {
      const result = await window.chatApi.removeFile(currentId, file.id);
      if (result?.ok) {
        currentFiles = result.files || [];
        renderFiles();
      }
    });
    chip.appendChild(label);
    chip.appendChild(del);
    attachList.appendChild(chip);
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeUrl(href) {
  const url = String(href || "").trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  return "";
}

function renderMarkdown(text) {
  const source = String(text || "");
  if (!source.trim()) return "";
  try {
    const html = window.marked.parse(source, {
      gfm: true,
      breaks: true,
    });
    return String(html)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<table[\s\S]*?<\/table>/gi, (table) => `<div class="table-wrap">${table}</div>`);
  } catch {
    return escapeHtml(source).replace(/\n/g, "<br>");
  }
}

if (window.marked?.use) {
  window.marked.use({
    gfm: true,
    breaks: true,
    renderer: {
      html() {
        return "";
      },
      link(token) {
        const url = safeUrl(token.href);
        const body = this.parser.parseInline(token.tokens || []);
        if (!url) return body;
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${body}</a>`;
      },
    },
  });
}

function setComposerEnabled(on) {
  input.disabled = !on;
  sendBtn.disabled = !on || (!input.value.trim() && !currentFiles.length);
}

function setStreamingUi(on) {
  streaming = on;
  sendBtn.classList.toggle("hidden", on);
  stopBtn.classList.toggle("hidden", !on);
  setComposerEnabled(!on && Boolean(currentId));
}

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function renderSidebar() {
  chatListEl.innerHTML = "";
  if (!chats.length) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    empty.textContent = "Пока нет сохранённых чатов";
    chatListEl.appendChild(empty);
    return;
  }

  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = `chat-item${chat.id === currentId ? " active" : ""}`;
    row.dataset.id = chat.id;

    const title = document.createElement("span");
    title.textContent = chat.title || "Новый чат";
    title.title = "Двойной щелчок — переименовать";
    title.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      beginRename(chat.id, title.textContent, title);
    });
    row.appendChild(title);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "tiny-del";
    del.title = "Удалить";
    del.textContent = "×";
    del.addEventListener("click", async (event) => {
      event.stopPropagation();
      await removeChat(chat.id);
    });
    row.appendChild(del);

    row.addEventListener("click", () => openChat(chat.id));
    chatListEl.appendChild(row);
  }
}

function estimateTokens(text) {
  const length = String(text || "").length;
  return length ? Math.ceil(length / 3) : 0;
}

function promptTokens(message) {
  // Первый вызов хода: история + инструкции + описание инструментов.
  // Следующие вызовы хода тащат в себя содержимое прочитанных файлов и шаги модели,
  // а в историю чата они не сохраняются.
  const calls = message.usage?.calls || [];
  if (calls.length) {
    const first = calls.find((call) => call.step === 0) || calls[0];
    return Number(first.inputTokens) || 0;
  }
  return Number(message.usage?.inputTokens) || 0;
}

function searchInflated(message, messages, index) {
  if (!message.used?.webSearch) return false;
  const input = promptTokens(message);
  const history = messages.slice(0, index).reduce((sum, item) => sum + estimateTokens(item.content), 0);
  const baseline = history + 800;
  return input > baseline * 2 && input - baseline > 2000;
}

function contextTokens(messages) {
  const list = messages || [];
  let anchor = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message.role !== "assistant" || !message.usage) continue;
    if (searchInflated(message, list, index)) continue;
    anchor = index;
    break;
  }
  if (anchor >= 0) {
    let tokens = promptTokens(list[anchor]);
    for (let index = anchor; index < list.length; index += 1) {
      tokens += estimateTokens(list[index].content);
    }
    return { tokens, estimated: false };
  }
  const chars = list.reduce((sum, message) => sum + String(message.content || "").length, 0);
  return { tokens: chars ? Math.ceil(chars / 3) : 0, estimated: chars > 0 };
}

function renderContext(messages) {
  if (!currentId) {
    contextSizeEl.classList.add("hidden");
    return;
  }
  const { tokens, estimated } = contextTokens(messages);
  const count = Number(tokens || 0).toLocaleString("ru-RU");
  contextSizeEl.classList.remove("hidden");
  contextSizeEl.textContent = estimated ? `Контекст ≈ ${count}` : `Контекст ${count}`;
  contextSizeEl.title = estimated
    ? "Оценка по длине текста. Точное число появится после ответа без веб-поиска."
    : "История чата и служебные инструкции для следующего запроса. Страницы веб-поиска и содержимое прочитанных файлов в это число не входят.";
}

function ensureReasoning(el) {
  let box = el.querySelector(".reasoning-spoiler");
  if (!box) {
    box = document.createElement("details");
    box.className = "reasoning-spoiler";
    const summary = document.createElement("summary");
    summary.textContent = "Рассуждения";
    const body = document.createElement("div");
    body.className = "reasoning-body";
    box.append(summary, body);
    const usage = el.querySelector(".message-usage");
    const messageBody = el.querySelector(".message-body");
    el.insertBefore(box, usage || messageBody);
  }
  return box.querySelector(".reasoning-body");
}

function setReasoning(el, text) {
  const value = String(text || "");
  if (!value.trim()) return;
  ensureReasoning(el).textContent = value;
}

let renameLock = false;

function beginRename(id, currentTitle, host) {
  if (!id || renameLock || host.querySelector("input")) return;
  const previous = String(currentTitle || "").trim() || "Новый чат";
  const field = document.createElement("input");
  field.type = "text";
  field.className = host === chatTitleEl ? "title-input" : "sidebar-rename";
  field.value = previous === "Новый чат" ? "" : previous;
  host.textContent = "";
  host.appendChild(field);
  field.focus();
  field.select();

  const finish = async (save) => {
    if (renameLock) return;
    renameLock = true;
    const next = field.value.trim() || "Новый чат";
    const saveTitle = save && field.dataset.cancel !== "1";
    field.remove();
    host.textContent = saveTitle ? next : previous;
    try {
      if (saveTitle && next !== previous) {
        await window.chatApi.renameChat(id, next);
        if (currentId === id && host !== chatTitleEl) chatTitleEl.textContent = next;
        await refreshList();
      }
    } finally {
      renameLock = false;
    }
  };

  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      field.blur();
    } else if (event.key === "Escape") {
      field.value = previous === "Новый чат" ? "" : previous;
      field.dataset.cancel = "1";
      field.blur();
    }
  });
  field.addEventListener("blur", () => {
    finish(field.dataset.cancel !== "1");
  });
}

function fileOpLabel(op) {
  const labels = {
    write: "Сохранён",
    read: "Прочитан",
    edit: "Изменён",
    list: "Папка",
    mkdir: "Создана папка",
    open: "Открыт",
  };
  const prefix = op.ok === false ? "Ошибка" : labels[op.action] || op.action;
  return op.path ? `${prefix}: ${op.path}` : `${prefix}${op.detail ? ` — ${op.detail}` : ""}`;
}

function addExtras(el, { citations = [], images = [], previewImages = [], status = "", fileOps = [] } = {}) {
  let statusEl = el.querySelector(".message-status");
  if (status) {
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "message-status";
      el.insertBefore(statusEl, el._body);
    }
    statusEl.textContent = status;
  } else if (statusEl) {
    statusEl.remove();
  }

  const imageList = images.length ? images : previewImages;
  if (imageList.length) {
    let box = el.querySelector(".message-images");
    if (!box) {
      box = document.createElement("div");
      box.className = "message-images";
      el.appendChild(box);
    }
    box.innerHTML = "";
    for (const src of imageList) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Изображение";
      box.appendChild(img);
    }
  }

  if (citations.length) {
    let box = el.querySelector(".message-citations");
    if (!box) {
      box = document.createElement("div");
      box.className = "message-citations";
      el.appendChild(box);
    }
    box.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = "Источники";
    box.appendChild(title);
    for (const item of citations) {
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = item.title || item.url;
      box.appendChild(link);
    }
  }

  if (fileOps.length) {
    let box = el.querySelector(".message-files");
    if (!box) {
      box = document.createElement("div");
      box.className = "message-files";
      el.appendChild(box);
    }
    box.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = "Файлы на компьютере";
    box.appendChild(title);
    for (const op of fileOps) {
      const row = document.createElement("div");
      row.className = op.ok === false ? "file-op error" : "file-op";
      row.textContent = fileOpLabel(op);
      box.appendChild(row);
    }
  }
}

function formatUsage(usage) {
  if (!usage?.totalTokens) return "";
  const count = (value) => Number(value || 0).toLocaleString("ru-RU");
  const parts = [`${count(usage.totalTokens)} всего`, `${count(usage.inputTokens)} вход`, `${count(usage.outputTokens)} выход`];
  if (usage.cachedTokens) parts.push(`${count(usage.cachedTokens)} кэш`);
  if (usage.reasoningTokens) parts.push(`${count(usage.reasoningTokens)} рассуждения`);
  return parts.join(" · ");
}

function setUsage(el, usage) {
  const text = formatUsage(usage);
  if (!text) return;
  let node = el.querySelector(".message-usage");
  if (!node) {
    node = document.createElement("div");
    node.className = "message-usage";
    const body = el.querySelector(".message-body");
    el.insertBefore(node, body);
  }
  node.textContent = text;
}

function addMessage(role, content, extra = {}) {
  const { streamingText = false, error = false, model = "" } = extra;
  emptyStateEl.classList.add("hidden");
  const el = document.createElement("div");
  el.className = `message ${error ? "error" : role}`;
  if (streamingText) el.classList.add("typing");

  if (role === "assistant" && model && !error) {
    const meta = document.createElement("div");
    meta.className = "message-model";
    meta.textContent = extra.reasoning && reasoningLabel(extra.reasoning)
      ? `${modelLabel(model)} · ${reasoningLabel(extra.reasoning)}`
      : modelLabel(model);
    el.appendChild(meta);
  }

  const body = document.createElement("div");
  body.className = "message-body";
  if (role === "assistant" && !error) {
    body.innerHTML = renderMarkdown(content || "");
  } else {
    body.textContent = content || "";
  }
  el.appendChild(body);
  el._body = body;
  setReasoning(el, extra.reasoningText);
  setUsage(el, extra.usage);
  addExtras(el, extra);
  messagesEl.appendChild(el);
  dialogEl.scrollTop = dialogEl.scrollHeight;
  return el;
}

function showEmpty() {
  messagesEl.innerHTML = "";
  emptyTitleEl.textContent = "Локальный чат с GPT";
  emptyTextEl.textContent =
    "Создайте чат слева и напишите сообщение. Чат может читать и сохранять файлы на этом компьютере.";
  emptyStateEl.classList.remove("hidden");
  chatTitleEl.textContent = "Выберите чат";
  headerActions.classList.add("hidden");
  contextSizeEl.classList.add("hidden");
  currentId = null;
  currentFiles = [];
  renderFiles();
  setComposerEnabled(false);
}

async function refreshList() {
  chats = await window.chatApi.listChats();
  renderSidebar();
}

async function openChat(id) {
  const chat = await window.chatApi.getChat(id);
  currentId = chat.id;
  chatTitleEl.textContent = chat.title || "Новый чат";
  headerActions.classList.remove("hidden");
  renderContext(chat.messages);
  messagesEl.innerHTML = "";

  if (!chat.messages.length) {
    emptyTitleEl.textContent = "Новый диалог";
    emptyTextEl.textContent =
      "Напишите, что сделать с файлом и куда его положить — чат умеет читать и сохранять документы на диске.";
    emptyStateEl.classList.remove("hidden");
  } else {
    emptyStateEl.classList.add("hidden");
    for (const message of chat.messages) {
      addMessage(message.role, message.content, {
        model: message.model,
        reasoning: message.reasoning,
        reasoningText: message.reasoningText,
        usage: message.usage,
        citations: message.citations || [],
        images: message.images || [],
        previewImages: message.previewImages || [],
        fileOps: message.fileOps || [],
      });
    }
  }

  currentFiles = chat.files || [];
  renderFiles();
  setComposerEnabled(!streaming);
  input.focus();
  renderSidebar();
}

async function createChat() {
  const chat = await window.chatApi.createChat();
  await refreshList();
  await openChat(chat.id);
}

async function removeChat(id) {
  await window.chatApi.deleteChat(id);
  await refreshList();
  if (currentId === id) {
    if (chats[0]) await openChat(chats[0].id);
    else showEmpty();
  } else {
    renderSidebar();
  }
}

newChatBtn.addEventListener("click", createChat);
renameChatBtn.addEventListener("click", () => {
  if (!currentId || chatTitleEl.querySelector("input")) return;
  beginRename(currentId, chatTitleEl.textContent, chatTitleEl);
});
chatTitleEl.addEventListener("click", () => {
  if (!currentId || chatTitleEl.querySelector("input")) return;
  beginRename(currentId, chatTitleEl.textContent, chatTitleEl);
});
deleteChatBtn.addEventListener("click", () => {
  if (currentId) removeChat(currentId);
});

input.addEventListener("input", () => {
  autosize();
  sendBtn.disabled = streaming || !currentId || (!input.value.trim() && !currentFiles.length);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  let text = input.value.trim();
  if (!currentId || streaming) return;
  if (!text && !currentFiles.length) return;
  if (!text) text = "Посмотри прикреплённые файлы.";

  input.value = "";
  autosize();
  addMessage("user", text);
  assistantEl = addMessage("assistant", "", {
    streamingText: true,
    model: selectedModel(),
    reasoning: reasoningSelect.value,
  });
  setStreamingUi(true);

  const result = await window.chatApi.sendMessage(currentId, text, {
    model: selectedModel(),
    reasoning: reasoningSelect.value,
    webSearch: toolOn("webSearch"),
    codeInterpreter: toolOn("codeInterpreter"),
    imageGen: toolOn("imageGen"),
    imageQuality: imageQuality.value,
    imageSize: imageSize.value,
  });
  if (!result?.ok && result?.error && assistantEl) {
    assistantEl.remove();
    assistantEl = null;
    addMessage("assistant", result.error, { error: true });
    setStreamingUi(false);
  }
});

attachBtn.addEventListener("click", () => {
  if (!currentId || streaming) return;
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const picked = [...fileInput.files];
  fileInput.value = "";
  if (!currentId || !picked.length) return;
  for (const file of picked) {
    const data = new Uint8Array(await file.arrayBuffer());
    const result = await window.chatApi.attachFile(currentId, {
      name: file.name,
      mime: file.type,
      data,
    });
    if (!result?.ok) {
      addMessage("assistant", result?.error || "Не удалось прикрепить файл", { error: true });
      continue;
    }
    currentFiles = result.files || [];
  }
  renderFiles();
  sendBtn.disabled = streaming || !currentId || (!input.value.trim() && !currentFiles.length);
});

stopBtn.addEventListener("click", () => {
  window.chatApi.stop();
});

window.chatApi.onReasoning(({ chatId, delta, text }) => {
  if (chatId !== currentId || !assistantEl) return;
  if (typeof text === "string") setReasoning(assistantEl, text);
  else if (delta) {
    const body = ensureReasoning(assistantEl);
    body.textContent += delta;
  }
});

window.chatApi.onChunk(({ chatId, delta }) => {
  if (chatId !== currentId || !assistantEl) return;
  assistantEl.classList.add("typing");
  assistantEl.dataset.raw = (assistantEl.dataset.raw || "") + delta;
  const body = assistantEl._body || assistantEl;
  body.innerHTML = renderMarkdown(assistantEl.dataset.raw);
  dialogEl.scrollTop = dialogEl.scrollHeight;
});

window.chatApi.onStatus(({ chatId, status }) => {
  if (chatId !== currentId || !assistantEl) return;
  addExtras(assistantEl, { status });
});

window.chatApi.onImage(({ chatId, dataUrl }) => {
  if (chatId !== currentId || !assistantEl || !dataUrl) return;
  const images = [...(assistantEl._images || []), dataUrl];
  assistantEl._images = images;
  addExtras(assistantEl, { images });
  dialogEl.scrollTop = dialogEl.scrollHeight;
});

window.chatApi.onFile(({ chatId, op }) => {
  if (chatId !== currentId || !assistantEl || !op) return;
  const fileOps = [...(assistantEl._fileOps || []), op];
  assistantEl._fileOps = fileOps;
  addExtras(assistantEl, { fileOps });
  dialogEl.scrollTop = dialogEl.scrollHeight;
});

window.chatApi.onDone(async ({ chatId, content, title, citations, images, fileOps, usage, reasoningText }) => {
  if (assistantEl) {
    assistantEl.classList.remove("typing");
    assistantEl.dataset.raw = content || assistantEl.dataset.raw || "";
    const body = assistantEl._body || assistantEl;
    body.innerHTML = renderMarkdown(assistantEl.dataset.raw || "");
    setReasoning(assistantEl, reasoningText);
    setUsage(assistantEl, usage);
    addExtras(assistantEl, {
      status: "",
      citations: citations || [],
      images: images || assistantEl._images || [],
      fileOps: fileOps || assistantEl._fileOps || [],
    });
    assistantEl = null;
  }
  if (title) chatTitleEl.textContent = title;
  setStreamingUi(false);
  if (chatId === currentId) {
    await refreshList();
    const chat = await window.chatApi.getChat(currentId);
    currentFiles = chat.files || [];
    renderContext(chat.messages);
    renderFiles();
  }
  input.focus();
});

window.chatApi.onError(({ error }) => {
  if (assistantEl) {
    assistantEl.remove();
    assistantEl = null;
  }
  addMessage("assistant", error || "Ошибка запроса", { error: true });
  setStreamingUi(false);
});

(async function init() {
  applyTheme(await window.chatApi.getTheme());
  window.chatApi.onTheme(({ theme }) => applyTheme(theme));
  const catalog = await window.chatApi.getModels();
  fillModels(catalog);
  fillReasoning(catalog);
  await refreshList();
  if (chats[0]) await openChat(chats[0].id);
  else showEmpty();
})();
