const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function findDataRoot() {
  let current = __dirname;
  for (let index = 0; index < 6; index += 1) {
    const candidate = path.join(current, "data");
    if (fs.existsSync(path.join(candidate, "hermes-agent-registry.json"))) return candidate;
    current = path.dirname(current);
  }
  return "/Users/michaelchuang/agent/小愛_bot/workspace/data";
}

const defaultLogPath = path.join(findDataRoot(), "skill-usage.jsonl");
const defaultDataRoot = process.env.HERMES_AGENT_DATA_ROOT || path.dirname(defaultLogPath);
const defaultRegistryPath = process.env.HERMES_AGENT_REGISTRY_PATH || path.join(defaultDataRoot, "hermes-agent-registry.json");
const defaultInvocationLogPath = process.env.HERMES_INVOCATION_LOG_PATH || path.join(defaultDataRoot, "invocations.jsonl");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeText(value, maxLength = 260) {
  const text = String(value || "")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-token]")
    .replace(/(token|api[_-]?key|password|secret)\s*[:=]\s*\\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}...` : text;
}

function sanitizeObject(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return sanitizeText(value, 320);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeObject(item, depth + 1));
  if (typeof value !== "object") return String(value);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|api[_-]?key|password|secret|cookie|authorization/i.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = sanitizeObject(item, depth + 1);
    }
  }
  return output;
}

function estimateTokens(value) {
  const text = String(value || "");
  const ascii = (text.match(/[\x00-\x7F]/g) || []).length;
  const nonAscii = text.length - ascii;
  return Math.ceil(ascii / 4 + nonAscii / 1.8);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function loadRegistry() {
  const doc = readJson(defaultRegistryPath, { agents: [] });
  return Array.isArray(doc.agents) ? doc.agents : [];
}

function findAgent(agentNameOrId) {
  const key = String(agentNameOrId || "").trim().toLowerCase();
  if (!key) return null;
  return loadRegistry().find((agent) => {
    return String(agent.id || "").toLowerCase() === key || String(agent.name || "").toLowerCase() === key;
  }) || null;
}

function appendJsonLine(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function durationMsFrom(event, metadata) {
  const direct = ["durationMs", "elapsedMs", "latencyMs", "runMs"]
    .map((key) => Number(event[key] || metadata[key]))
    .find((value) => Number.isFinite(value) && value > 0);
  if (direct) return Math.round(direct);
  const seconds = ["durationSeconds", "elapsedSeconds", "latencySeconds", "runSeconds"]
    .map((key) => Number(event[key] || metadata[key]))
    .find((value) => Number.isFinite(value) && value > 0);
  if (seconds) return Math.round(seconds * 1000);
  const minutes = ["durationMinutes", "elapsedMinutes", "runMinutes"]
    .map((key) => Number(event[key] || metadata[key]))
    .find((value) => Number.isFinite(value) && value > 0);
  return minutes ? Math.round(minutes * 60000) : 0;
}

function isoFrom(value, fallback) {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function buildInvocation(event, usageRecord, metadata) {
  const endedAt = isoFrom(event.endedAt || event.finishedAt, usageRecord.at);
  const durationMs = durationMsFrom(event, metadata);
  const startedAt = isoFrom(
    event.startedAt || event.startTime,
    durationMs ? new Date(new Date(endedAt).getTime() - durationMs).toISOString() : usageRecord.at,
  );
  const tool = sanitizeText(event.tool || event.toolName || event.command || usageRecord.skills[0] || usageRecord.event, 120);
  const task = sanitizeText(event.task || usageRecord.question || usageRecord.event, 360);
  const result = sanitizeText(event.result || event.outcome || usageRecord.answer || "logged", 360);
  const outcome = event.error || event.ok === false || event.success === false ? "error" : String(event.outcomeStatus || event.status || "ok");
  return {
    at: usageRecord.at,
    invocationId: String(event.invocationId || crypto.randomUUID()),
    agent: usageRecord.agent,
    tool,
    task,
    result,
    outcome,
    event: usageRecord.event,
    skills: usageRecord.skills,
    source: usageRecord.source,
    startedAt,
    endedAt,
    durationMs,
    estimatedTokens: usageRecord.estimatedTokens,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

function writeAgentStatus(invocation, event) {
  const agent = findAgent(invocation.agent);
  const statusPath = event.statusPath
    || process.env.HERMES_AGENT_STATUS_PATH
    || (agent?.path ? path.join(agent.path, "data", "status.json") : "");
  if (!statusPath) return null;
  const state = String(event.state || event.heartbeatState || (event.inProgress ? "working" : "idle"));
  const status = {
    version: 1,
    updatedAt: new Date().toISOString(),
    agentId: String(agent?.id || event.agentId || invocation.agent),
    agentName: String(agent?.name || invocation.agent),
    state,
    label: state === "idle" ? "idle" : state,
    currentWork: state === "idle" ? "" : invocation.task,
    startedAt: invocation.startedAt,
    endedAt: state === "idle" ? invocation.endedAt : "",
    token: invocation.estimatedTokens,
    tokens: invocation.estimatedTokens,
    lastInvocation: {
      invocationId: invocation.invocationId,
      tool: invocation.tool,
      task: invocation.task,
      result: invocation.result,
      outcome: invocation.outcome,
      startedAt: invocation.startedAt,
      endedAt: invocation.endedAt,
      durationMs: invocation.durationMs,
      estimatedTokens: invocation.estimatedTokens,
    },
  };
  ensureDir(path.dirname(statusPath));
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), { mode: 0o600 });
  return status;
}

function logSkillUsage(event) {
  const logPath = process.env.SKILL_USAGE_LOG_PATH || defaultLogPath;
  const skills = Array.isArray(event.skills) ? event.skills.map(String) : [];
  const question = sanitizeText(event.question || event.prompt || "");
  const answer = sanitizeText(event.answer || "", 180);
  const metadata = event.metadata && typeof event.metadata === "object" ? sanitizeObject(event.metadata) : {};
  for (const key of ["durationMs", "elapsedMs", "latencyMs", "runMs", "durationSeconds", "elapsedSeconds", "durationMinutes"]) {
    if (Number.isFinite(Number(event[key])) && Number(event[key]) > 0 && metadata[key] === undefined) {
      metadata[key] = Number(event[key]);
    }
  }
  const record = {
    at: new Date().toISOString(),
    agent: String(event.agent || event.botName || "unknown-agent"),
    event: String(event.event || "skill.event"),
    skills,
    source: String(event.source || "local"),
    question,
    answer,
    estimatedTokens: Number(event.estimatedTokens || estimateTokens(`${question}\n${answer}`)),
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };

  appendJsonLine(logPath, record);
  const invocation = buildInvocation(event, record, metadata);
  appendJsonLine(defaultInvocationLogPath, invocation);
  writeAgentStatus(invocation, event);
  return record;
}

module.exports = {
  estimateTokens,
  logSkillUsage,
  sanitizeText,
  sanitizeObject,
};
