const fs = require("fs");
const path = require("path");
const { buildToolContext, describeAvailableTools, saveAgentMemory } = require("./toolRouter");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function appendLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${value}\n`, "utf8");
}

function truncate(text, maxLength = 3400) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  );
}

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  };
  walk(dir);
  return files.sort();
}

function splitChunks(text, source) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({ source, text: chunk }));
}

function loadKnowledge({ wikiDir, learnedPath }) {
  const chunks = [];
  for (const file of listMarkdownFiles(wikiDir)) {
    chunks.push(...splitChunks(readText(file), path.relative(wikiDir, file)));
  }
  chunks.push(...splitChunks(readText(learnedPath), "memory/learned_wiki.md"));
  return chunks;
}

function findRelevant(chunks, question, limit = 6) {
  const terms = tokenize(question);
  if (terms.length === 0) return chunks.slice(0, limit);

  return chunks
    .map((chunk) => {
      const lower = chunk.text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    .slice(0, limit);
}

function readRecentHistory(historyPath, limit = 8) {
  const lines = readText(historyPath)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit);
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function callOllama(prompt, systemPrompt) {
  const baseUrl = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/api\/generate\/?$/, "").replace(/\/$/, "");
  const model = process.env.MODEL_NAME || process.env.OLLAMA_MODEL || "qwen3:8b";
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      ...(model.startsWith("qwen3") || model.startsWith("gemma4") ? { think: false } : {}),
      prompt: `系統提示：${systemPrompt}\n\n使用者訊息：${prompt}`,
      stream: false,
      options: {
        temperature: 0.35,
        top_p: 0.9,
        repeat_penalty: 1.08,
        num_ctx: Number(process.env.OLLAMA_CONTEXT_LENGTH || 8192),
      },
    }),
  });
  if (!response.ok) throw new Error(`Ollama failed ${response.status}`);
  const data = await response.json();
  return data.response || "";
}

function defaultWiki(botName, domain) {
  return [
    `# ${botName} LLM Wiki`,
    "",
    "## 這個知識庫的用途",
    "",
    `這裡放 ${botName} 的可回答範圍、操作流程、常見問題與長期知識。`,
    "",
    "## 回答原則",
    "",
    "- 優先回答和本 bot 任務相關的問題。",
    "- 不讀取或輸出 `.env`、token、cookie、瀏覽器 session、SQLite 內容等秘密。",
    "- 不確定時要說明限制，並提供下一步可以怎麼查。",
    "- 使用繁體中文，回答要短、清楚、可操作。",
    "",
    "## 目前領域",
    "",
    domain,
    "",
  ].join("\n");
}

function ensureWikiChat(config) {
  const wikiDir = path.join(config.projectRoot, "wiki");
  const memoryDir = path.join(config.projectRoot, "memory");
  const learnedPath = path.join(memoryDir, "learned_wiki.md");
  const historyPath = path.join(memoryDir, "chat_history.jsonl");

  ensureDir(wikiDir);
  ensureDir(memoryDir);
  writeIfMissing(path.join(wikiDir, "index.md"), defaultWiki(config.botName, config.domain));
  writeIfMissing(learnedPath, `# ${config.botName} Learned Wiki\n\n`);

  return { wikiDir, memoryDir, learnedPath, historyPath };
}

function isWikiCommand(text) {
  const trimmed = String(text || "").trim();
  return trimmed === "/wiki" || trimmed === "知識庫" || trimmed === "Wiki";
}

function isMemoryCommand(text) {
  const trimmed = String(text || "").trim();
  return trimmed === "/memory" || trimmed === "聊天紀錄" || trimmed === "記憶";
}

function isLearnCommand(text) {
  return String(text || "").trim().startsWith("/learn ");
}

async function answerWikiChat(config, question, options = {}) {
  const trimmed = String(question || "").trim();
  const paths = ensureWikiChat(config);

  if (isWikiCommand(trimmed)) {
    const files = listMarkdownFiles(paths.wikiDir).map((file) => `- ${path.relative(paths.wikiDir, file)}`);
    return [`${config.botName} 知識庫：`, "", ...(files.length ? files : ["- index.md"])].join("\n");
  }

  if (isMemoryCommand(trimmed)) {
    const recent = readRecentHistory(paths.historyPath, 6);
    if (recent.length === 0) return "目前還沒有聊天紀錄。";
    return [
      `${config.botName} 最近被問過：`,
      "",
      ...recent.map((item, index) => `${index + 1}. ${item.question}`),
    ].join("\n");
  }

  if (trimmed === "/tools" || trimmed === "工具" || trimmed === "可用工具") {
    return describeAvailableTools("");
  }

  if (isLearnCommand(trimmed)) {
    const note = trimmed.replace(/^\/learn\s+/, "").trim();
    if (!note) return "請輸入要記住的內容，例如：/learn 之後寄報告先確認收件人";
    appendLine(paths.learnedPath, `- ${nowIso()} 手動記憶：${note}`);
    return "已記住，之後回答會把這點納入。";
  }

  const cleanQuestion = trimmed.replace(/^\/chat\s*/i, "").trim();
  const chunks = loadKnowledge(paths);
  const relevant = findRelevant(chunks, cleanQuestion, 6);
  const recent = readRecentHistory(paths.historyPath, 6);
  const toolContext = await buildToolContext(config, cleanQuestion);
  const context = relevant
    .map((chunk, index) => `[${index + 1}] ${chunk.source}\n${truncate(chunk.text, 700)}`)
    .join("\n\n");
  const memory = recent
    .map((item) => `Q: ${item.question}\nA: ${truncate(item.answer, 260)}`)
    .join("\n\n");

  const systemPrompt = [
    `你是 ${config.botName} 的聊天與知識庫助理。`,
    config.domain,
    "請使用繁體中文回答。",
    "只能根據知識庫、最近聊天記憶與你被授權的專案背景回答。",
    "你有工具路由提示：該用長期記憶、CodeGraph、資安 skills、Understand-Anything 或開發流程 skills 時，要把它納入判斷。",
    "不要要求或揭露 token、cookie、.env、SQLite 私密內容。",
    "如果問題超出本 bot 範圍，請簡短說明並建議該問哪個 bot。",
  ].join("\n");

  const prompt = [
    `使用者問題：${cleanQuestion}`,
    "",
    "相關知識庫：",
    context || "目前沒有命中的知識庫內容。",
    "",
    "最近聊天記憶：",
    memory || "目前沒有最近聊天記憶。",
    "",
    "工具路由：",
    toolContext,
  ].join("\n");

  let answer;
  try {
    if (typeof options.generate === "function") {
      answer = await options.generate(prompt, systemPrompt);
    } else {
      answer = await callOllama(prompt, systemPrompt);
    }
  } catch {
    answer = [
      "我目前無法連上本地 LLM，先根據知識庫給你方向：",
      "",
      relevant.length ? relevant.map((chunk) => `- ${truncate(chunk.text, 180)}`).join("\n") : "目前知識庫還沒有足夠內容。",
    ].join("\n");
  }

  answer = truncate(answer || "我目前沒有足夠資訊回答。");
  appendLine(paths.historyPath, JSON.stringify({
    at: nowIso(),
    chatId: options.chatId ? String(options.chatId) : undefined,
    user: options.user || undefined,
    question: cleanQuestion,
    answer,
  }));
  appendLine(paths.learnedPath, `- ${nowIso()} 問：「${truncate(cleanQuestion, 160)}」；答：「${truncate(answer, 260)}」`);
  await saveAgentMemory(config, cleanQuestion, answer);

  return answer;
}

module.exports = {
  answerWikiChat,
  ensureWikiChat,
};
