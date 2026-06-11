const fs = require("fs");
const path = require("path");

const PROJECT_DIR = path.join(__dirname, "..");

// 備份位置 1：放在 AD 資料夾底下，避免誤刪 ADLink_PM_bot 時一起消失
const EXTERNAL_BACKUP_ROOT = "/Users/michaelchuang/AD/ADLink_PM_bot_backup";
const EXTERNAL_BACKUP_DIR = path.join(EXTERNAL_BACKUP_ROOT, "stable");

// 備份位置 2：放在 ADLink_PM_bot 專案裡，方便專案內快速查看
const INTERNAL_BACKUP_DIR = path.join(PROJECT_DIR, "backups", "stable");

const BACKUP_DIRS = [
  {
    name: "AD 外部備份",
    dir: EXTERNAL_BACKUP_DIR,
  },
  {
    name: "專案內部備份",
    dir: INTERNAL_BACKUP_DIR,
  },
];

const FILES = [
  {
    name: "bot.js",
    source: path.join(PROJECT_DIR, "bot.js"),
    backupName: "bot.js",
  },
  {
    name: "local.js",
    source: path.join(PROJECT_DIR, "local.js"),
    backupName: "local.js",
  },
  {
    name: "tools/excelScanner.js",
    source: path.join(PROJECT_DIR, "tools", "excelScanner.js"),
    backupName: "excelScanner.js",
  },
  {
    name: "tools/htmlReport.js",
    source: path.join(PROJECT_DIR, "tools", "htmlReport.js"),
    backupName: "htmlReport.js",
  },
  {
    name: "tools/backupManager.js",
    source: path.join(PROJECT_DIR, "tools", "backupManager.js"),
    backupName: "backupManager.js",
  },
  {
    name: "core/telegramHealth.js",
    source: path.join(PROJECT_DIR, "core", "telegramHealth.js"),
    backupName: "telegramHealth.js",
  },
  {
    name: "core/config.js",
    source: path.join(PROJECT_DIR, "core", "config.js"),
    backupName: "config.js",
  },
  {
    name: "core/excelRules.js",
    source: path.join(PROJECT_DIR, "core", "excelRules.js"),
    backupName: "excelRules.js",
  },
  {
    name: ".env",
    source: path.join(PROJECT_DIR, ".env"),
    backupName: ".env",
    optional: true,
  },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getBackupFilePath(backupDir, file) {
  return path.join(backupDir, file.backupName);
}

function createStableBackup() {
  const copied = [];
  const skipped = [];

  for (const backupTarget of BACKUP_DIRS) {
    ensureDir(backupTarget.dir);
  }

  for (const file of FILES) {
    if (!fs.existsSync(file.source)) {
      if (file.optional) {
        skipped.push(file.name);
        continue;
      }

      throw new Error(`找不到來源檔案：${file.source}`);
    }

    for (const backupTarget of BACKUP_DIRS) {
      const backupPath = getBackupFilePath(backupTarget.dir, file);
      fs.copyFileSync(file.source, backupPath);
    }

    copied.push(file.name);
  }

  const now = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
  });

  const infoText = [
    `備份時間：${now}`,
    "",
    "備份位置：",
    ...BACKUP_DIRS.map((target) => `- ${target.name}：${target.dir}`),
    "",
    "已備份檔案：",
    ...copied.map((name) => `- ${name}`),
    "",
    skipped.length > 0 ? "略過檔案：" : "",
    ...skipped.map((name) => `- ${name}`),
  ]
    .filter(Boolean)
    .join("\n");

  for (const backupTarget of BACKUP_DIRS) {
    fs.writeFileSync(
      path.join(backupTarget.dir, "backup_info.txt"),
      infoText,
      "utf8"
    );
  }

  return {
    success: true,
    message: [
      "✅ 已建立 stable 備份。",
      "",
      "已同時備份到兩個位置：",
      "",
      `1. AD 外部備份：`,
      EXTERNAL_BACKUP_DIR,
      "",
      `2. 專案內部備份：`,
      INTERNAL_BACKUP_DIR,
      "",
      "已備份檔案：",
      ...copied.map((name) => `- ${name}`),
      "",
      skipped.length > 0 ? "略過檔案：" : "",
      ...skipped.map((name) => `- ${name}`),
      "",
      "之後如果改壞，可以按「🧩 還原備份」回到這個版本。",
      "",
      "提醒：如果誤刪 ADLink_PM_bot，外部備份仍會保留在 AD 資料夾底下。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function backupHasRequiredFiles(backupDir) {
  if (!fs.existsSync(backupDir)) {
    return false;
  }

  for (const file of FILES) {
    if (file.optional) {
      continue;
    }

    const backupPath = getBackupFilePath(backupDir, file);

    if (!fs.existsSync(backupPath)) {
      return false;
    }
  }

  return true;
}

function getRestoreBackupDir() {
  if (backupHasRequiredFiles(EXTERNAL_BACKUP_DIR)) {
    return {
      name: "AD 外部備份",
      dir: EXTERNAL_BACKUP_DIR,
    };
  }

  if (backupHasRequiredFiles(INTERNAL_BACKUP_DIR)) {
    return {
      name: "專案內部備份",
      dir: INTERNAL_BACKUP_DIR,
    };
  }

  throw new Error(
    [
      "找不到可用的 stable 備份，或備份檔案不完整。",
      "",
      "已檢查以下位置：",
      `1. ${EXTERNAL_BACKUP_DIR}`,
      `2. ${INTERNAL_BACKUP_DIR}`,
      "",
      "請先按「💾 建立備份」。",
    ].join("\n")
  );
}

function restoreStableBackup() {
  const restoreSource = getRestoreBackupDir();

  const restored = [];
  const skipped = [];

  for (const file of FILES) {
    const backupPath = getBackupFilePath(restoreSource.dir, file);

    if (!fs.existsSync(backupPath)) {
      if (file.optional) {
        skipped.push(file.name);
        continue;
      }

      throw new Error(`找不到備份檔案：${backupPath}`);
    }

    const targetDir = path.dirname(file.source);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.copyFileSync(backupPath, file.source);
    restored.push(file.name);
  }

  return {
    success: true,
    message: [
      "✅ 已還原 stable 備份版本。",
      "",
      "還原來源：",
      `${restoreSource.name}：${restoreSource.dir}`,
      "",
      "已還原檔案：",
      ...restored.map((name) => `- ${name}`),
      "",
      skipped.length > 0 ? "略過檔案：" : "",
      ...skipped.map((name) => `- ${name}`),
      "",
      "⚠️ 重要：目前正在執行的 bot 不會自動更新。",
      "請回終端機按 Ctrl + C 停止，然後重新執行：",
      "",
      "node bot.js",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

module.exports = {
  createStableBackup,
  restoreStableBackup,
};