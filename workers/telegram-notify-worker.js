const ALLOWED_ACTIONS = new Set([
  "login",
  "login_failed",
  "logout",
  "analyze_started",
  "analyze_failed",
  "report_generated",
  "download_report",
]);

function corsHeaders(origin, env) {
  const allowedOrigin = env.ALLOWED_ORIGIN || "https://mm7382.github.io";
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonResponse(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin, env),
    },
  });
}

function cleanText(value, max = 300) {
  return String(value || "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, max)
    .trim();
}

function formatDetails(details = {}) {
  const lines = [];
  if (details.mode) lines.push(`Mode: ${cleanText(details.mode, 80)}`);
  if (Array.isArray(details.files) && details.files.length) {
    lines.push(`Files: ${details.files.map((file) => cleanText(file, 120)).join(", ")}`);
  }
  if (details.resultCount !== undefined) lines.push(`Result count: ${details.resultCount}`);
  if (Array.isArray(details.categories) && details.categories.length) {
    lines.push(`Categories: ${details.categories.map((category) => cleanText(category, 60)).join(", ")}`);
  }
  if (details.error) lines.push(`Error: ${cleanText(details.error, 500)}`);
  return lines;
}

function formatTelegramMessage(payload, request) {
  const action = cleanText(payload.action, 80);
  const user = cleanText(payload.user || payload.details?.user || "N/A", 120);
  const ip = request.headers.get("CF-Connecting-IP") || "N/A";
  const country = request.headers.get("CF-IPCountry") || "N/A";
  const page = cleanText(payload.page, 250);
  const time = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });

  return [
    "ADLINK PM Report",
    `Action: ${action}`,
    `User: ${user}`,
    `Time: ${time}`,
    `IP: ${ip}`,
    `Country: ${country}`,
    page ? `Page: ${page}` : "",
    ...formatDetails(payload.details),
  ].filter(Boolean).join("\n");
}

async function sendTelegram(env, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_NOTIFY_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: "Missing Telegram settings." };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    return { ok: false, error: await response.text() };
  }

  return { ok: true };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://mm7382.github.io";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, origin, env);
    }

    if (origin !== allowedOrigin) {
      return jsonResponse({ error: "Origin not allowed." }, 403, origin, env);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return jsonResponse({ error: "Invalid JSON." }, 400, origin, env);
    }

    if (!ALLOWED_ACTIONS.has(payload.action)) {
      return jsonResponse({ error: "Invalid action." }, 400, origin, env);
    }

    const result = await sendTelegram(env, formatTelegramMessage(payload, request));
    if (!result.ok) {
      return jsonResponse({ error: result.error }, 500, origin, env);
    }

    return jsonResponse({ ok: true }, 200, origin, env);
  },
};
