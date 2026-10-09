const fs = require("fs/promises");
const path = require("path");
const { net } = require("electron");

const MAX_MESSAGE = 3500;
const MAX_CAPTION = 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_ALBUM = 10;

const TELEGRAM_INSTRUCTIONS = `Для Telegram-канала есть инструмент telegram_post.
- Публикуй только если пользователь явно просит выложить, опубликовать или запостить. Если просит только набросать пост — покажи текст в чате и не вызывай инструмент.
- В инструмент передавай готовый текст поста, без предисловий вроде «вот пост».
- Если пользователь прислал скрины или фото для поста, передай images: ["all"] — так в пост попадут фото из его последнего сообщения. Можно перечислить имена файлов. Пустой массив images — только текст.
- Пиши так, как это читают подписчики канала: коротко, по-человечески, без служебных пометок чата.
- Пост выходит от имени канала, не с личного аккаунта.`;

const TELEGRAM_TOOLS = [
  {
    type: "function",
    name: "telegram_post",
    description:
      "Опубликовать пост в Telegram-канале. Можно прикрепить фото из чата. Вызывай только по прямой просьбе выложить или опубликовать.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Готовый текст поста. Можно **жирный**, *курсив* и ссылки. Пустая строка, если нужны только фото.",
        },
        images: {
          type: "array",
          items: { type: "string" },
          description: 'Имена фото из чата или ["all"] для скринов из последнего сообщения пользователя. [] — без картинок.',
        },
      },
      required: ["text", "images"],
      additionalProperties: false,
    },
    strict: true,
  },
];

function token() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

function channelId() {
  return String(process.env.TELEGRAM_CHANNEL_ID || "").trim();
}

function isConfigured() {
  return Boolean(token() && channelId());
}

function imageName(image) {
  return String(image?.name || path.basename(image?.localPath || "")).trim();
}

function catalog(chat) {
  const list = [];
  const seen = new Set();
  const add = (image) => {
    if (!image?.localPath) return;
    const key = path.resolve(image.localPath);
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      name: imageName(image) || path.basename(image.localPath),
      localPath: image.localPath,
      mime: image.mime || "image/jpeg",
    });
  };
  for (const file of chat?.files || []) {
    if (file.kind === "image") add(file);
  }
  for (const message of chat?.messages || []) {
    for (const image of message.images || []) add(image);
  }
  return list;
}

function imageNames(chat) {
  return catalog(chat).map((image) => image.name);
}

function lastUserAlbum(chat) {
  const messages = chat?.messages || [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const images = (message.images || []).filter((image) => image.localPath);
    if (images.length) {
      return images.map((image) => ({
        name: imageName(image) || path.basename(image.localPath),
        localPath: image.localPath,
        mime: image.mime || "image/jpeg",
      }));
    }
  }
  return (chat?.files || [])
    .filter((file) => file.kind === "image" && file.localPath)
    .map((file) => ({
      name: imageName(file),
      localPath: file.localPath,
      mime: file.mime || "image/jpeg",
    }));
}

function resolveImages(args, chat) {
  const requested = Array.isArray(args?.images) ? args.images.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!requested.length) return [];
  if (requested.length === 1 && /^(all|\*|все)$/i.test(requested[0])) {
    return lastUserAlbum(chat);
  }
  const byName = new Map();
  for (const image of catalog(chat)) {
    byName.set(image.name.toLowerCase(), image);
  }
  const resolved = [];
  const missing = [];
  for (const name of requested) {
    const hit = byName.get(name.toLowerCase());
    if (hit) resolved.push(hit);
    else missing.push(name);
  }
  if (missing.length) {
    const available = [...byName.keys()];
    throw new Error(
      `Не нашёл фото: ${missing.join(", ")}.${available.length ? ` В чате есть: ${available.join(", ")}.` : ""}`
    );
  }
  return resolved;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toTelegramHtml(source) {
  const fences = [];
  const codes = [];
  let body = String(source || "").replace(/\r\n/g, "\n");
  body = body.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => {
    const index = fences.length;
    fences.push(`<pre>${escapeHtml(code.replace(/\n$/, ""))}</pre>`);
    return `\0F${index}\0`;
  });
  body = body.replace(/`([^`]+)`/g, (_, code) => {
    const index = codes.length;
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\0C${index}\0`;
  });
  body = escapeHtml(body);
  body = body.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  body = body.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  body = body.replace(/__([^_]+)__/g, "<b>$1</b>");
  body = body.replace(/(^|[^\w*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  body = body.replace(/(^|[^\w_])_([^_\n]+)_/g, "$1<i>$2</i>");
  body = body.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  body = body.replace(/\0C(\d+)\0/g, (_, index) => codes[Number(index)] || "");
  body = body.replace(/\0F(\d+)\0/g, (_, index) => fences[Number(index)] || "");
  return body.trim();
}

function fitsCaption(text) {
  if (!text) return false;
  if (text.length > MAX_CAPTION) return false;
  return toTelegramHtml(text).length <= MAX_CAPTION;
}

function splitText(text) {
  const source = String(text || "").trim();
  if (source.length <= MAX_MESSAGE) return source ? [source] : [];
  const parts = [];
  let rest = source;
  while (rest.length) {
    if (rest.length <= MAX_MESSAGE) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n\n", MAX_MESSAGE);
    if (cut < MAX_MESSAGE / 2) cut = rest.lastIndexOf("\n", MAX_MESSAGE);
    if (cut < MAX_MESSAGE / 2) cut = MAX_MESSAGE;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return parts.filter(Boolean);
}

function postLink(messageId) {
  const id = channelId();
  if (!messageId || !id.startsWith("@")) return "";
  return `https://t.me/${id.slice(1)}/${messageId}`;
}

function describeTelegramError(description) {
  const text = String(description || "");
  if (/unauthorized/i.test(text)) return "Неверный TELEGRAM_BOT_TOKEN в .env.";
  if (/chat not found/i.test(text)) {
    return "Канал не найден. В TELEGRAM_CHANNEL_ID укажи @имя_канала или числовой id вроде -100…";
  }
  if (/not enough rights|need administrator|kicked/i.test(text)) {
    return "Бот должен быть администратором канала с правом публиковать сообщения.";
  }
  if (/photo.*too big|file is too big/i.test(text)) return "Фото слишком большое для Telegram (лимит 10 МБ).";
  return text || "Telegram не принял пост.";
}

function networkErrorMessage(err) {
  const text = `${err?.code || ""} ${err?.cause?.code || ""} ${err?.message || ""} ${err?.cause?.message || ""}`;
  if (/ERR_INVALID_ARGUMENT/i.test(text)) {
    return "Telegram отклонил запрос. Попробуй выложить ещё раз.";
  }
  if (/ECONNRESET|EPIPE|ERR_CONNECTION_RESET|ERR_CONNECTION_ABORTED|socket hang up/i.test(text)) {
    return "Связь с Telegram оборвалась. Если мессенджер открывается через VPN — включи его и отправь ещё раз.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_TIMED_OUT/i.test(text)) {
    return "Нет соединения с api.telegram.org. Проверь интернет, VPN или прокси.";
  }
  return "";
}

function isRetryable(err) {
  const text = `${err?.code || ""} ${err?.cause?.code || ""} ${err?.message || ""}`;
  return /ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ERR_CONNECTION_RESET|ERR_CONNECTION_ABORTED|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_TIMED_OUT|socket hang up/i.test(
    text
  );
}

function ok(status, payload, op) {
  return { ok: true, status, payload, op };
}

function fail(message) {
  return {
    ok: false,
    status: message,
    payload: { ok: false, error: message },
    op: { action: "telegram", ok: false, detail: message },
  };
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(90_000);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function electronPost(url, { headers, body, signal }) {
  const payload = Buffer.isBuffer(body) ? Uint8Array.from(body) : body;
  const response = await net.fetch(url, {
    method: "POST",
    headers,
    body: payload,
    signal,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function encodeMultipart(fields, files) {
  const boundary = `----OAIChat${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const chunks = [];
  const push = (data) => chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8"));
  for (const [name, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  for (const file of files) {
    const filename = String(file.filename || "photo.jpg").replace(/[\r\n"]/g, "_");
    const mime = file.mime || "application/octet-stream";
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
    );
    push(file.buffer);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);
  const body = Buffer.concat(chunks);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function apiRequest(method, { json, fields, files, signal }) {
  const url = `https://api.telegram.org/bot${token()}/${method}`;
  const combined = requestSignal(signal);
  let headers;
  let body;
  if (files?.length) {
    const encoded = encodeMultipart(fields || {}, files);
    headers = { "Content-Type": encoded.contentType };
    body = encoded.body;
  } else {
    headers = { "Content-Type": "application/json" };
    body = JSON.stringify(json);
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { status, data } = await electronPost(url, { headers, body, signal: combined });
      if (!data?.ok) {
        const error = new Error(describeTelegramError(data?.description || `HTTP ${status}`));
        error.parseFailed = /can't parse entities/i.test(String(data?.description || ""));
        throw error;
      }
      return data.result;
    } catch (err) {
      lastErr = err;
      if (combined.aborted || signal?.aborted) throw err;
      if (err.parseFailed || !isRetryable(err) || attempt === 2) throw err;
      await wait(400 * (attempt + 1), combined);
    }
  }
  throw lastErr;
}

function lastResult(result) {
  if (Array.isArray(result)) return result[result.length - 1] || {};
  return result || {};
}

function photoExt(image) {
  const fromName = path.extname(image.name || image.localPath || "");
  if (fromName) return fromName;
  if (/jpe?g/i.test(image.mime || "")) return ".jpg";
  if (/webp/i.test(image.mime || "")) return ".webp";
  if (/gif/i.test(image.mime || "")) return ".gif";
  return ".png";
}

async function loadPhoto(image) {
  const buffer = await fs.readFile(image.localPath);
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error(`Файл ${image.name} больше 10 МБ, Telegram такое фото не принимает.`);
  }
  return {
    field: "photo",
    filename: `photo${photoExt(image)}`,
    mime: image.mime || "image/jpeg",
    buffer,
  };
}

function captionFields(caption) {
  if (!caption) return {};
  const html = toTelegramHtml(caption);
  if (html.length <= MAX_CAPTION) {
    return { caption: html, parse_mode: "HTML" };
  }
  return {};
}

async function sendPhoto(file, caption, signal) {
  try {
    return lastResult(
      await apiRequest("sendPhoto", {
        fields: { chat_id: channelId(), ...captionFields(caption) },
        files: [file],
        signal,
      })
    );
  } catch (err) {
    if (!err.parseFailed || !caption) throw err;
    return lastResult(
      await apiRequest("sendPhoto", {
        fields: { chat_id: channelId(), caption },
        files: [file],
        signal,
      })
    );
  }
}

async function sendAlbum(files, caption, signal) {
  const media = files.map((file, index) => {
    const item = { type: "photo", media: `attach://photo${index}` };
    if (index === 0 && caption) Object.assign(item, captionFields(caption));
    return item;
  });
  const attached = files.map((file, index) => ({ ...file, field: `photo${index}` }));
  try {
    return lastResult(
      await apiRequest("sendMediaGroup", {
        fields: { chat_id: channelId(), media: JSON.stringify(media) },
        files: attached,
        signal,
      })
    );
  } catch (err) {
    if (!err.parseFailed || !caption) throw err;
    const plain = files.map((file, index) => {
      const item = { type: "photo", media: `attach://photo${index}` };
      if (index === 0) item.caption = caption;
      return item;
    });
    return lastResult(
      await apiRequest("sendMediaGroup", {
        fields: { chat_id: channelId(), media: JSON.stringify(plain) },
        files: attached,
        signal,
      })
    );
  }
}

async function sendPhotos(images, caption, signal) {
  const loaded = [];
  for (const image of images) loaded.push(await loadPhoto(image));
  const results = [];
  let leftoverCaption = caption;
  for (let index = 0; index < loaded.length; index += MAX_ALBUM) {
    const group = loaded.slice(index, index + MAX_ALBUM);
    const cap = leftoverCaption;
    leftoverCaption = "";
    if (group.length === 1) results.push(await sendPhoto(group[0], cap, signal));
    else results.push(await sendAlbum(group, cap, signal));
  }
  return results;
}

async function sendChunk(text, signal) {
  const html = toTelegramHtml(text);
  try {
    return lastResult(
      await apiRequest("sendMessage", {
        json: {
          chat_id: channelId(),
          text: html,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        signal,
      })
    );
  } catch (err) {
    if (!err.parseFailed) throw err;
    return lastResult(
      await apiRequest("sendMessage", {
        json: {
          chat_id: channelId(),
          text,
          disable_web_page_preview: true,
        },
        signal,
      })
    );
  }
}

async function execute(args, signal, chat) {
  if (!isConfigured()) {
    return fail(
      "В .env нет Telegram. Добавь TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL_ID (@имя_канала или -100…) и сделай бота администратором канала."
    );
  }
  const text = String(args?.text || "").trim();
  let images = [];
  try {
    images = resolveImages(args, chat);
  } catch (err) {
    return fail(err.message);
  }
  if (!text && !images.length) return fail("Нужен текст поста или фото.");
  try {
    const results = [];
    let leftoverText = text;
    let caption = "";
    if (images.length && fitsCaption(text)) {
      caption = text;
      leftoverText = "";
    }
    if (images.length) results.push(...(await sendPhotos(images, caption, signal)));
    for (const chunk of splitText(leftoverText)) {
      results.push(await sendChunk(chunk, signal));
    }
    const last = results[results.length - 1] || {};
    const link = postLink(last.message_id);
    const photoNote = images.length ? ` (${images.length} фото)` : "";
    const status = link
      ? `Опубликовано в Telegram: ${link}${photoNote}`
      : `Опубликовано в Telegram-канале.${photoNote}`;
    return ok(
      status,
      { ok: true, messageId: last.message_id, link, parts: results.length, photos: images.length },
      { action: "telegram", ok: true, detail: `${link || channelId()}${photoNote}` }
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    const message = networkErrorMessage(err)
      || (err?.name === "TimeoutError" || err?.name === "AbortError"
        ? "Telegram не ответил. Проверь интернет и отправь ещё раз."
        : err?.message || "Не удалось опубликовать пост.");
    return fail(message);
  }
}

module.exports = {
  TELEGRAM_TOOLS,
  TELEGRAM_INSTRUCTIONS,
  execute,
  isConfigured,
  imageNames,
};
