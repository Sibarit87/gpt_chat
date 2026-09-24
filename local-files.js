const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { shell } = require("electron");
const JSZip = require("jszip");
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");

const MAX_READ_CHARS = 80000;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_DIR_ENTRIES = 300;

const ALLOWED_EXT = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".html",
  ".htm",
  ".xml",
  ".log",
  ".rtf",
  ".docx",
  ".ini",
  ".yml",
  ".yaml",
  ".toml",
  ".css",
  ".sql",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
]);

const BLOCKED_EXT = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".ps1",
  ".msi",
  ".dll",
  ".sys",
  ".scr",
  ".com",
  ".vbs",
  ".lnk",
  ".reg",
]);

const BLOCKED_SEGMENTS = new Set([".ssh", ".gnupg", ".aws", ".azure", "appdata", "application data"]);

const FILE_INSTRUCTIONS = `Ты работаешь в локальном чате на компьютере пользователя (Windows).
У тебя есть инструменты для файлов на диске: list_dir, read_file, write_file, edit_file, mkdir, reveal_in_explorer.
Правила:
- Сохраняй и читай файлы только по пути, который назвал пользователь. Если путь относительный, клади файл в папку Документы.
- Для договоров и длинных документов используй расширение .docx. Для заметок и распознанного текста — .txt или .md.
- После записи всегда назови полный путь к файлу.
- Если пользователь прислал фото рукописи, распознай текст, поправь орфографию и оформление, затем сохрани файлом.
- Не трогай системные папки и исполняемые файлы.
- Перед правкой существующего файла сначала прочитай его.`;

const FILE_TOOLS = [
  {
    type: "function",
    name: "list_dir",
    description: "Показать содержимое папки на компьютере пользователя.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Полный путь к папке, например C:\\\\Users\\\\Name\\\\Documents" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "read_file",
    description: "Прочитать текстовый файл или Word (.docx) с диска пользователя.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Полный путь к файлу" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "write_file",
    description:
      "Создать или полностью перезаписать файл. Для .docx собирается Word-документ из текста. Родительские папки создаются при необходимости.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Полный путь, например C:\\\\Users\\\\Name\\\\Documents\\\\dogovor.docx",
        },
        content: { type: "string", description: "Полный текст файла в UTF-8" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "edit_file",
    description: "Заменить фрагмент в существующем текстовом файле. Для .docx не использовать — перезапиши через write_file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Полный путь к файлу" },
        old_text: { type: "string", description: "Точный фрагмент, который нужно заменить" },
        new_text: { type: "string", description: "Новый фрагмент" },
        replace_all: { type: "boolean", description: "true — заменить все вхождения, false — только первое" },
      },
      required: ["path", "old_text", "new_text", "replace_all"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "mkdir",
    description: "Создать папку, включая промежуточные.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Полный путь к новой папке" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "reveal_in_explorer",
    description: "Открыть Проводник Windows и показать файл или папку.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Полный путь к файлу или папке" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
];

function documentsDir() {
  return path.join(os.homedir(), "Documents");
}

function resolveUserPath(input) {
  let raw = String(input || "").trim();
  if (!raw) throw new Error("Путь пустой");
  if (raw.startsWith("~")) raw = path.join(os.homedir(), raw.slice(1));
  if (!path.isAbsolute(raw)) raw = path.join(documentsDir(), raw);
  return path.resolve(raw);
}

function blockedLocation(resolved) {
  const lower = resolved.toLowerCase();
  const winRoot = path.parse(resolved).root.toLowerCase();
  const blockedRoots = [
    path.join(winRoot, "Windows").toLowerCase(),
    path.join(winRoot, "Program Files").toLowerCase(),
    path.join(winRoot, "Program Files (x86)").toLowerCase(),
    path.join(winRoot, "ProgramData").toLowerCase(),
  ];
  if (blockedRoots.some((root) => lower === root || lower.startsWith(`${root}\\`))) return true;
  const parts = resolved.split(/[/\\]/).map((part) => part.toLowerCase());
  if (parts.some((part) => BLOCKED_SEGMENTS.has(part))) return true;
  if (lower.endsWith("\\.env") || lower.endsWith("/.env")) return true;
  return false;
}

function assertExtension(resolved, { allowEmpty = false } = {}) {
  const ext = path.extname(resolved).toLowerCase();
  if (!ext) {
    if (allowEmpty) return;
    throw new Error("Укажи расширение файла, например .txt, .md или .docx");
  }
  if (BLOCKED_EXT.has(ext)) throw new Error(`Тип ${ext} закрыт для безопасности`);
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`Можно работать только с текстовыми файлами и Word. Этот тип нельзя: ${ext}`);
  }
}

async function resolveSafe(userPath, { mustExist = false, asDir = false } = {}) {
  const resolved = resolveUserPath(userPath);
  if (blockedLocation(resolved)) throw new Error("Этот путь закрыт для безопасности");
  if (!asDir) assertExtension(resolved, { allowEmpty: false });

  if (mustExist) {
    const real = await fs.realpath(resolved);
    if (blockedLocation(real)) throw new Error("Этот путь закрыт для безопасности");
    return real;
  }

  let dir = path.dirname(resolved);
  try {
    dir = await fs.realpath(dir);
  } catch {
    if (blockedLocation(dir)) throw new Error("Этот путь закрыт для безопасности");
    return resolved;
  }
  if (blockedLocation(dir)) throw new Error("Этот путь закрыт для безопасности");
  return resolved;
}

async function resolveDir(userPath, { mustExist = false } = {}) {
  const resolved = resolveUserPath(userPath);
  if (blockedLocation(resolved)) throw new Error("Этот путь закрыт для безопасности");
  if (mustExist) {
    const real = await fs.realpath(resolved);
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw new Error("Это не папка");
    if (blockedLocation(real)) throw new Error("Этот путь закрыт для безопасности");
    return real;
  }
  return resolved;
}

async function readDocxText(filePath) {
  const buf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Не удалось прочитать Word-файл");
  const xml = await file.async("string");
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^/]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function writeDocx(filePath, content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const children = lines.map((line) => {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const headingLevel =
        level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      return new Paragraph({ text: heading[2], heading: headingLevel });
    }
    if (!line) return new Paragraph({ children: [] });
    return new Paragraph({ children: [new TextRun(line)] });
  });
  const doc = new Document({
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
  const buf = await Packer.toBuffer(doc);
  await fs.writeFile(filePath, buf);
}

function clip(text) {
  if (text.length <= MAX_READ_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_READ_CHARS)}\n\n[Обрезано: в файле ${text.length} символов, показаны первые ${MAX_READ_CHARS}]`,
    truncated: true,
  };
}

function ok(status, payload, op) {
  return { ok: true, status, payload, op };
}

function fail(message, op) {
  return {
    ok: false,
    status: message,
    payload: { ok: false, error: message },
    op: op || { action: "error", ok: false, detail: message },
  };
}

async function listDir(args) {
  const dir = await resolveDir(args.path, { mustExist: true });
  const names = await fs.readdir(dir, { withFileTypes: true });
  const entries = [];
  for (const item of names.slice(0, MAX_DIR_ENTRIES)) {
    entries.push({
      name: item.name,
      type: item.isDirectory() ? "folder" : "file",
    });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "ru");
  });
  return ok(`Смотрю папку ${dir}`, { ok: true, path: dir, entries, truncated: names.length > MAX_DIR_ENTRIES }, {
    action: "list",
    path: dir,
    ok: true,
  });
}

async function readFile(args) {
  const filePath = await resolveSafe(args.path, { mustExist: true });
  const ext = path.extname(filePath).toLowerCase();
  const raw = ext === ".docx" ? await readDocxText(filePath) : await fs.readFile(filePath, "utf8");
  const { text, truncated } = clip(raw);
  return ok(`Читаю ${filePath}`, { ok: true, path: filePath, content: text, truncated }, {
    action: "read",
    path: filePath,
    ok: true,
  });
}

async function writeFile(args) {
  const filePath = await resolveSafe(args.path);
  const content = String(args.content ?? "");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) throw new Error("Файл слишком большой для записи");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (path.extname(filePath).toLowerCase() === ".docx") await writeDocx(filePath, content);
  else await fs.writeFile(filePath, content, "utf8");
  return ok(`Сохранил ${filePath}`, { ok: true, path: filePath, bytes }, {
    action: "write",
    path: filePath,
    ok: true,
  });
}

async function editFile(args) {
  const filePath = await resolveSafe(args.path, { mustExist: true });
  if (path.extname(filePath).toLowerCase() === ".docx") {
    throw new Error("Для Word используй write_file с полным текстом");
  }
  const oldText = String(args.old_text ?? "");
  if (!oldText) throw new Error("old_text пустой");
  const original = await fs.readFile(filePath, "utf8");
  if (!original.includes(oldText)) throw new Error("Фрагмент для замены в файле не найден");
  const next = args.replace_all ? original.split(oldText).join(args.new_text) : original.replace(oldText, args.new_text);
  await fs.writeFile(filePath, next, "utf8");
  return ok(`Правил ${filePath}`, { ok: true, path: filePath }, {
    action: "edit",
    path: filePath,
    ok: true,
  });
}

async function makeDir(args) {
  const dir = await resolveDir(args.path);
  await fs.mkdir(dir, { recursive: true });
  return ok(`Создал папку ${dir}`, { ok: true, path: dir }, { action: "mkdir", path: dir, ok: true });
}

async function reveal(args) {
  const target = resolveUserPath(args.path);
  if (blockedLocation(target)) throw new Error("Этот путь закрыт для безопасности");
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) await shell.openPath(target);
    else shell.showItemInFolder(target);
  } catch {
    shell.showItemInFolder(target);
  }
  return ok(`Открыл ${target}`, { ok: true, path: target }, { action: "open", path: target, ok: true });
}

const HANDLERS = {
  list_dir: listDir,
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  mkdir: makeDir,
  reveal_in_explorer: reveal,
};

async function execute(name, args) {
  const handler = HANDLERS[name];
  if (!handler) return fail(`Неизвестный инструмент: ${name}`);
  try {
    return await handler(args && typeof args === "object" ? args : {});
  } catch (err) {
    const message = err?.message || String(err);
    return fail(message, { action: name, ok: false, detail: message });
  }
}

module.exports = {
  FILE_TOOLS,
  FILE_INSTRUCTIONS,
  execute,
};
