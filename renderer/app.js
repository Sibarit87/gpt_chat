const chatListEl = document.getElementById("chatList");
const dialogEl = document.getElementById("dialog");
const messagesEl = document.getElementById("messages");
const emptyStateEl = document.getElementById("emptyState");
const emptyTitleEl = document.getElementById("emptyTitle");
const emptyTextEl = document.getElementById("emptyText");
const chatTitleEl = document.getElementById("chatTitle");
const newChatBtn = document.getElementById("newChatBtn");
const deleteChatBtn = document.getElementById("deleteChatBtn");
const composer = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const stopBtn = document.getElementById("stopBtn");
const modelSelect = document.getElementById("modelSelect");
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
let defaultModel = "gpt-6-luna";
let currentFiles = [];

function modelLabel(id) {
  return models.find((model) => model.id === id)?.label || id || "";
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

modelSelect.addEventListener("change", () => {
  localStorage.setItem(MODEL_STORAGE_KEY, modelSelect.value);
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

function addExtras(el, { citations = [], images = [], previewImages = [], status = "" } = {}) {
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
    meta.textContent = modelLabel(model);
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
  addExtras(el, extra);
  messagesEl.appendChild(el);
  dialogEl.scrollTop = dialogEl.scrollHeight;
  return el;
}

function showEmpty() {
  messagesEl.innerHTML = "";
  emptyTitleEl.textContent = "Локальный чат с GPT";
  emptyTextEl.textContent =
    "Создайте чат слева и напишите сообщение. История хранится на этом компьютере.";
  emptyStateEl.classList.remove("hidden");
  chatTitleEl.textContent = "Выберите чат";
  deleteChatBtn.classList.add("hidden");
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
  deleteChatBtn.classList.remove("hidden");
  messagesEl.innerHTML = "";

  if (!chat.messages.length) {
    emptyTitleEl.textContent = "Новый диалог";
    emptyTextEl.textContent =
      "Напишите первое сообщение — оно сохранится на этом компьютере.";
    emptyStateEl.classList.remove("hidden");
  } else {
    emptyStateEl.classList.add("hidden");
    for (const message of chat.messages) {
      addMessage(message.role, message.content, {
        model: message.model,
        citations: message.citations || [],
        images: message.images || [],
        previewImages: message.previewImages || [],
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
  assistantEl = addMessage("assistant", "", { streamingText: true, model: selectedModel() });
  setStreamingUi(true);

  const result = await window.chatApi.sendMessage(currentId, text, {
    model: selectedModel(),
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

window.chatApi.onDone(async ({ chatId, content, title, citations, images }) => {
  if (assistantEl) {
    assistantEl.classList.remove("typing");
    assistantEl.dataset.raw = content || assistantEl.dataset.raw || "";
    const body = assistantEl._body || assistantEl;
    body.innerHTML = renderMarkdown(assistantEl.dataset.raw || "");
    addExtras(assistantEl, {
      status: "",
      citations: citations || [],
      images: images || assistantEl._images || [],
    });
    assistantEl = null;
  }
  if (title) chatTitleEl.textContent = title;
  setStreamingUi(false);
  if (chatId === currentId) {
    await refreshList();
    const chat = await window.chatApi.getChat(currentId);
    currentFiles = chat.files || [];
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
  fillModels(await window.chatApi.getModels());
  await refreshList();
  if (chats[0]) await openChat(chats[0].id);
  else showEmpty();
})();
