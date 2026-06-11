const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const USERS_PATH = process.env.WEB_USERS_PATH || path.join(__dirname, "../data/web-users.json");
const DEFAULT_USER_NAMES = [
  "Tyler Pei",
  "Anson JM Lin",
  "David Wang",
  "Eric YH1 Lin",
  "Frankie Chuang",
  "Karl Lin",
  "Michael Chuang",
  "Sean Ba",
];

function normalizeUsername(username) {
  return String(username || "").replace(/\s+/g, " ").trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  const actual = crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("hex");

  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function emptyStore() {
  return {
    version: 1,
    users: [],
  };
}

function readUsers() {
  if (!fs.existsSync(USERS_PATH)) return emptyStore();
  return JSON.parse(fs.readFileSync(USERS_PATH, "utf8"));
}

function writeUsers(store) {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  fs.writeFileSync(USERS_PATH, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function findUser(store, username) {
  const normalized = normalizeUsername(username).toLowerCase();
  return store.users.find((user) => normalizeUsername(user.username).toLowerCase() === normalized);
}

function createUser({ username, password, isAdmin = false, status = "active" }) {
  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername) throw new Error("請輸入帳號名稱。");
  if (!password || String(password).length < 6) throw new Error("密碼至少需要 6 個字元。");

  const store = readUsers();
  if (findUser(store, cleanUsername)) {
    throw new Error("帳號名稱已存在。");
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomBytes(12).toString("hex"),
    username: cleanUsername,
    passwordHash: hashPassword(password),
    isAdmin: Boolean(isAdmin),
    status,
    createdAt: now,
    updatedAt: now,
  };

  store.users.push(user);
  writeUsers(store);

  return publicUser(user);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    isAdmin: Boolean(user.isAdmin),
    status: user.status || "active",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function listUsers() {
  return readUsers().users.map(publicUser);
}

function authenticateUser(username, password) {
  const store = readUsers();
  const user = findUser(store, username);

  if (!user || user.status !== "active") return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  user.lastLoginAt = new Date().toISOString();
  writeUsers(store);

  return publicUser(user);
}

function bootstrapUsersFromEnv(env = process.env) {
  const store = readUsers();
  if (store.users.length > 0) return;

  const adminUsername = normalizeUsername(env.WEB_ADMIN_USERNAME || "Michael Chuang");
  const adminPassword = env.WEB_ADMIN_PASSWORD || env.WEB_PASSWORD || env.WEB_ACCESS_PASSWORD;

  if (!adminPassword) {
    throw new Error("Missing WEB_ADMIN_PASSWORD or WEB_PASSWORD. Set one before starting web.js.");
  }

  const now = new Date().toISOString();
  store.users.push({
    id: crypto.randomBytes(12).toString("hex"),
    username: adminUsername,
    passwordHash: hashPassword(adminPassword),
    isAdmin: true,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  writeUsers(store);
}

module.exports = {
  DEFAULT_USER_NAMES,
  USERS_PATH,
  authenticateUser,
  bootstrapUsersFromEnv,
  createUser,
  listUsers,
  normalizeUsername,
};
