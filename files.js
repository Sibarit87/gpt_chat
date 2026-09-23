const fs = require("fs/promises");
const path = require("path");
const { toFile } = require("openai");

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const DOC_EXTS = new Set([
  ".pdf",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".doc",
  ".docx",
  ".xlsx",
  ".xls",
  ".pptx",
  ".html",
  ".htm",
]);
const MAX_BYTES = 32 * 1024 * 1024;

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (data?.type === "Buffer" && Array.isArray(data.data)) return Buffer.from(data.data);
  throw new Error("Не удалось прочитать файл");
}

function filesDir(root, chatId) {
  return path.join(root, "files", chatId);
}

function kindOf(name, mime) {
  const type = String(mime || "").toLowerCase();
  if (IMAGE_TYPES.has(type) || /\.(png|jpe?g|webp|gif)$/i.test(name)) return "image";
  return "doc";
}

function publicFile(file) {
  return {
    id: file.id,
    name: file.name,
    mime: file.mime,
    kind: file.kind,
    bytes: file.bytes,
  };
}

async function ensureVectorStore(client, chat) {
  if (chat.vectorStoreId) return chat.vectorStoreId;
  const store = await client.vectorStores.create({ name: `chat-${chat.id}` });
  chat.vectorStoreId = store.id;
  return store.id;
}

async function attachFile(client, root, chat, payload) {
  const name = String(payload.name || "file").replace(/[<>:"/\\|?*]/g, "_");
  const mime = String(payload.mime || "application/octet-stream");
  const data = toBuffer(payload.data);
  if (!data.length) throw new Error("Пустой файл");
  if (data.length > MAX_BYTES) throw new Error("Файл больше 32 МБ");

  if (!Array.isArray(chat.files)) chat.files = [];
  const kind = kindOf(name, mime);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = filesDir(root, chat.id);
  await fs.mkdir(dir, { recursive: true });
  const localName = `${id}${path.extname(name) || ""}`;
  const localPath = path.join(dir, localName);
  await fs.writeFile(localPath, data);

  const file = {
    id,
    name,
    mime,
    kind,
    bytes: data.length,
    localPath,
    openaiFileId: null,
  };

  const upload = await toFile(data, name, { type: mime });
  if (kind === "image") {
    file.kind = "image";
  } else {
    file.kind = "doc";
    const vsId = await ensureVectorStore(client, chat);
    const vsFile = await client.vectorStores.files.uploadAndPoll(vsId, upload);
    file.openaiFileId = vsFile.id;
  }

  chat.files.push(file);
  chat.updatedAt = Date.now();
  return publicFile(file);
}

async function removeFile(client, chat, fileId) {
  const file = (chat.files || []).find((item) => item.id === fileId);
  if (!file) return;
  chat.files = chat.files.filter((item) => item.id !== fileId);
  chat.updatedAt = Date.now();
  try {
    if (file.localPath) await fs.unlink(file.localPath);
  } catch {
    // ignore
  }
  try {
    if (chat.vectorStoreId && file.kind === "doc" && file.openaiFileId) {
      await client.vectorStores.files.del(chat.vectorStoreId, file.openaiFileId);
    }
  } catch {
    // ignore remote cleanup errors
  }
}

async function readDataUrl(file) {
  const buf = await fs.readFile(file.localPath);
  return `data:${file.mime || "image/png"};base64,${buf.toString("base64")}`;
}

module.exports = {
  publicFile,
  attachFile,
  removeFile,
  readDataUrl,
  IMAGE_TYPES,
};
