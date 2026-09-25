const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

function chatsDir(root) {
  return path.join(root, "chats");
}

async function ensureDir(root) {
  await fs.mkdir(chatsDir(root), { recursive: true });
}

function chatPath(root, id) {
  return path.join(chatsDir(root), `${id}.json`);
}

function usageLogPath(root) {
  return path.join(root, "usage.jsonl");
}

async function listChats(root) {
  await ensureDir(root);
  const files = await fs.readdir(chatsDir(root));
  const chats = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(chatsDir(root), file), "utf8");
      const chat = JSON.parse(raw);
      chats.push({
        id: chat.id,
        title: chat.title || "Новый чат",
        updatedAt: chat.updatedAt || chat.createdAt || 0,
      });
    } catch {
      // skip broken files
    }
  }

  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  return chats;
}

async function getChat(root, id) {
  const raw = await fs.readFile(chatPath(root, id), "utf8");
  return JSON.parse(raw);
}

async function saveChat(root, chat) {
  await ensureDir(root);
  await fs.writeFile(chatPath(root, chat.id), JSON.stringify(chat, null, 2), "utf8");
  return chat;
}

async function appendUsage(root, record) {
  await fs.mkdir(root, { recursive: true });
  await fs.appendFile(usageLogPath(root), `${JSON.stringify(record)}\n`, "utf8");
}

async function deleteChat(root, id) {
  try {
    await fs.unlink(chatPath(root, id));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function createChat() {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Новый чат",
    createdAt: now,
    updatedAt: now,
    messages: [],
    files: [],
    vectorStoreId: null,
  };
}

async function migrateChats(targetRoot, sourceRoots) {
  await ensureDir(targetRoot);
  const seen = new Set();

  for (const source of sourceRoots) {
    const dir = chatsDir(source);
    if (!source || !fsSync.existsSync(dir)) continue;
    const resolved = path.resolve(dir);
    if (seen.has(resolved) || path.resolve(chatsDir(targetRoot)) === resolved) continue;
    seen.add(resolved);

    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const dest = path.join(chatsDir(targetRoot), file);
      if (fsSync.existsSync(dest)) continue;
      await fs.copyFile(path.join(dir, file), dest);
    }
  }
}

function titleFromMessage(text) {
  const line = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "Новый чат";
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

module.exports = {
  listChats,
  getChat,
  saveChat,
  appendUsage,
  deleteChat,
  createChat,
  titleFromMessage,
  migrateChats,
};
