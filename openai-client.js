const https = require("https");
const tls = require("tls");
const { Readable } = require("stream");
const OpenAI = require("openai");
const winCa = require("win-ca/api");

function loadCerts() {
  const certs = new Set(tls.rootCertificates);
  if (typeof tls.getCACertificates === "function") {
    try {
      for (const cert of tls.getCACertificates("system")) certs.add(cert);
    } catch {
      // Electron's Node may not support this API
    }
  }

  try {
    winCa({
      generator: false,
      fallback: true,
      format: winCa.der2.pem,
      ondata: (cert) => certs.add(cert),
    });
  } catch {
    // keep Mozilla roots even if Windows store is unavailable
  }

  return [...certs];
}

function toHeaderObject(headers) {
  if (!headers) return {};
  if (typeof headers.forEach === "function") {
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return { ...headers };
}

function writeBody(req, body) {
  if (body == null || body === "") {
    req.end();
    return;
  }
  if (typeof body.pipe === "function") {
    body.pipe(req);
    return;
  }
  if (typeof Readable.fromWeb === "function" && typeof body.getReader === "function") {
    Readable.fromWeb(body).pipe(req);
    return;
  }
  req.write(body);
  req.end();
}

function createFetch() {
  const agent = new https.Agent({
    ca: loadCerts(),
    keepAlive: true,
  });

  return (url, init = {}) =>
    new Promise((resolve, reject) => {
      const target = new URL(String(url));
      const req = https.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          method: init.method || "GET",
          headers: toHeaderObject(init.headers),
          agent,
        },
        (res) => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value == null) continue;
            if (Array.isArray(value)) value.forEach((item) => headers.append(key, String(item)));
            else headers.set(key, String(value));
          }
          resolve(
            new Response(Readable.toWeb(res), {
              status: res.statusCode,
              statusText: res.statusMessage,
              headers,
            })
          );
        }
      );

      req.on("error", reject);

      if (init.signal) {
        if (init.signal.aborted) {
          req.destroy();
          reject(init.signal.reason || new Error("Aborted"));
          return;
        }
        init.signal.addEventListener(
          "abort",
          () => {
            req.destroy();
          },
          { once: true }
        );
      }

      writeBody(req, init.body);
    });
}

let fetchImpl;

function createClient(apiKey) {
  if (!fetchImpl) fetchImpl = createFetch();
  return new OpenAI({
    apiKey: String(apiKey || "").trim(),
    fetch: fetchImpl,
    maxRetries: 0,
  });
}

function describeError(err) {
  const status = err?.status;
  const apiCode = err?.code;
  const tlsCode = err?.cause?.code || "";
  const text = `${err?.message || ""} ${err?.cause?.message || ""}`;

  if (status === 401 || apiCode === "invalid_api_key") {
    return "OpenAI отклонил ключ. Создайте новый на platform.openai.com/api-keys и запишите его в .env";
  }
  if (status === 429 && /rate limit reached/i.test(text)) {
    const wait = text.match(/try again in\s+([\d.]+)s/i);
    const seconds = wait ? Math.ceil(Number(wait[1])) : null;
    return seconds
      ? `Лимит токенов в минуту. Подождите около ${seconds} с и отправьте сообщение один раз.`
      : "Лимит токенов в минуту. Подождите около минуты и отправьте сообщение один раз.";
  }
  if (status === 429) {
    return "Закончилась квота OpenAI или сработал лимит трат. Проверьте баланс на platform.openai.com.";
  }
  if (status === 404) {
    return "Эта модель недоступна для текущего ключа.";
  }
  if (
    /SELF_SIGNED_CERT|UNABLE_TO_VERIFY|CERT_HAS_EXPIRED|UNABLE_TO_GET_ISSUER/i.test(
      `${tlsCode} ${text}`
    )
  ) {
    return "Антивирус или прокси подменяет HTTPS-сертификат, соединение с OpenAI заблокировано.";
  }
  if (tlsCode === "ENOTFOUND" || tlsCode === "ECONNREFUSED" || tlsCode === "ETIMEDOUT") {
    return "Нет соединения с api.openai.com. Проверьте интернет, VPN или прокси.";
  }
  if (/connection error/i.test(err?.message || "")) {
    return "Не удалось подключиться к OpenAI. Проверьте интернет, VPN и ключ в .env.";
  }
  return err?.message || "Ошибка запроса к OpenAI";
}

module.exports = { createClient, describeError };
