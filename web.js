require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const { scanExcelFolder } = require("./tools/excelScanner");
const { scanRedBlueFontCells } = require("./tools/excelColorScanner");
const { generateCriticalIssuesHtml } = require("./tools/htmlReport");
const { generateRedBlueFontHtml } = require("./tools/colorHtmlReport");
const {
  DEFAULT_USER_NAMES,
  authenticateUser,
  bootstrapUsersFromEnv,
  createUser,
  listUsers,
} = require("./core/webUsers");

const app = express();

const PORT = Number(process.env.PORT || process.env.WEB_PORT || 3000);
const SESSION_COOKIE = "adlink_pm_session";
const MAX_UPLOAD_BYTES = Number(process.env.WEB_MAX_UPLOAD_MB || 50) * 1024 * 1024;
const JOB_RETENTION_DAYS = Number(process.env.WEB_JOB_RETENTION_DAYS || 7);
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const JOBS_DIR = path.join(__dirname, "uploads", "jobs");
const sessions = new Map();

try {
  bootstrapUsersFromEnv(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

fs.mkdirSync(JOBS_DIR, { recursive: true });

function addSecurityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function isAuthenticated(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  return !!(token && sessions.has(token));
}

function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  return token ? sessions.get(token)?.user : null;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "請先登入。" });
  }
  return res.redirect("/login");
}

function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (user?.isAdmin) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(403).json({ error: "需要管理員權限。" });
  }
  return res.status(403).send("需要管理員權限。");
}

function sanitizeFileName(fileName) {
  const parsed = path.parse(fileName || "uploaded.xlsx");
  const safeName = parsed.name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "uploaded";
  return `${safeName}${parsed.ext.toLowerCase() || ".xlsx"}`;
}

function isAllowedExcelFile(fileName) {
  return [".xlsx", ".xls", ".xlsm"].includes(path.extname(fileName || "").toLowerCase());
}

function newJobId() {
  return crypto.randomBytes(24).toString("hex");
}

function safeJoin(baseDir, targetPath) {
  const resolved = path.resolve(baseDir, targetPath);
  const base = path.resolve(baseDir);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error("Invalid path.");
  }
  return resolved;
}

function createJob(req, res, next) {
  const jobId = newJobId();
  const jobDir = path.join(JOBS_DIR, jobId);
  const inputDir = path.join(jobDir, "input");
  const reportDir = path.join(jobDir, "reports");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });

  req.job = { id: jobId, dir: jobDir, inputDir, reportDir };
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, req.job.inputDir);
    },
    filename(req, file, cb) {
      cb(null, sanitizeFileName(file.originalname));
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter(req, file, cb) {
    if (!isAllowedExcelFile(file.originalname)) {
      return cb(new Error("只允許上傳 .xlsx / .xls / .xlsm 檔案。"));
    }
    cb(null, true);
  },
});

function cleanupOldJobs() {
  const cutoff = Date.now() - JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(JOBS_DIR)) return;

  for (const name of fs.readdirSync(JOBS_DIR)) {
    const jobDir = path.join(JOBS_DIR, name);
    let stat;
    try {
      stat = fs.statSync(jobDir);
    } catch (err) {
      continue;
    }

    if (stat.isDirectory() && stat.mtimeMs < cutoff) {
      fs.rmSync(jobDir, { recursive: true, force: true });
      console.log(`Cleaned old upload job: ${jobDir}`);
    }
  }
}

app.use(addSecurityHeaders);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "style.css"));
});

app.get("/app.js", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.js"));
});

app.get("/admin.js", requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.js"));
});

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const user = authenticateUser(username, password);

  if (!user) {
    return res.status(401).send("登入失敗，請確認帳號名稱與密碼。");
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { createdAt: Date.now(), user });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.WEB_SECURE_COOKIE === "true",
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  res.redirect("/login");
});

app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-users.html"));
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: getSessionUser(req) });
});

app.get("/api/users", requireAuth, requireAdmin, (req, res) => {
  res.json({
    users: listUsers(),
    suggestedUsernames: DEFAULT_USER_NAMES,
  });
});

app.post("/api/users", requireAuth, requireAdmin, (req, res, next) => {
  try {
    const user = createUser({
      username: req.body.username,
      password: req.body.password,
      isAdmin: req.body.isAdmin === true || req.body.isAdmin === "true",
    });

    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

app.post("/api/report", requireAuth, createJob, upload.single("excel"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "請上傳 Excel 檔案。" });
    }

    const mode = String(req.body.mode || "critical");
    const reports = [];

    if (mode === "critical" || mode === "both") {
      const criticalResults = scanExcelFolder(req.job.inputDir);
      const htmlPath = generateCriticalIssuesHtml(criticalResults, {
        outputDir: req.job.reportDir,
      });
      reports.push({
        type: "critical",
        count: criticalResults.length,
        fileName: path.basename(htmlPath),
        url: `/reports/${req.job.id}/${encodeURIComponent(path.basename(htmlPath))}`,
      });
    }

    if (mode === "red-blue" || mode === "both") {
      const redBlueResults = await scanRedBlueFontCells(req.job.inputDir);
      const htmlPath = generateRedBlueFontHtml(redBlueResults, {
        outputDir: req.job.reportDir,
      });
      reports.push({
        type: "red-blue",
        count: redBlueResults.length,
        fileName: path.basename(htmlPath),
        url: `/reports/${req.job.id}/${encodeURIComponent(path.basename(htmlPath))}`,
      });
    }

    if (reports.length === 0) {
      return res.status(400).json({ error: "未知的分析類型。" });
    }

    res.json({
      jobId: req.job.id,
      uploadedFile: req.file.originalname,
      reports,
      expiresAfterDays: JOB_RETENTION_DAYS,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/reports/:jobId/:fileName", (req, res, next) => {
  try {
    if (!/^[a-f0-9]{48}$/.test(req.params.jobId)) {
      return res.status(404).send("Report not found.");
    }

    const fileName = path.basename(req.params.fileName);
    if (!fileName.endsWith(".html")) {
      return res.status(404).send("Report not found.");
    }

    const reportPath = safeJoin(path.join(JOBS_DIR, req.params.jobId, "reports"), fileName);
    if (!fs.existsSync(reportPath)) {
      return res.status(404).send("Report not found.");
    }

    res.sendFile(reportPath);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);

  if (req.job?.dir) {
    fs.rmSync(req.job.dir, { recursive: true, force: true });
  }

  const message = err.code === "LIMIT_FILE_SIZE"
    ? `檔案超過 ${process.env.WEB_MAX_UPLOAD_MB || 50} MB 限制。`
    : err.message || "伺服器發生錯誤。";

  if (req.path.startsWith("/api/")) {
    return res.status(400).json({ error: message });
  }

  res.status(400).send(message);
});

cleanupOldJobs();
setInterval(cleanupOldJobs, CLEANUP_INTERVAL_MS).unref();

app.listen(PORT, () => {
  console.log(`ADLink PM web app running at http://localhost:${PORT}`);
  console.log(`Upload limit: ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
  console.log(`Job retention: ${JOB_RETENTION_DAYS} days`);
});
