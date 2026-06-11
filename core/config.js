require("dotenv").config();
const path = require("path");
const fs = require("fs");

/**
 * 集中管理所有環境變數與配置
 */
const config = {
  // Telegram 配置
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN,
  },

  // 掃描路徑配置
  paths: {
    // 優先使用環境變數中的 WORK_DIR 或 SCAN_TARGET_DIR，否則預設為專案上一層的 AD 資料夾
    scanTarget: process.env.SCAN_TARGET_DIR || process.env.WORK_DIR || path.resolve(__dirname, "../../AD"),
    outputDir: path.join(__dirname, "../output"),
    backupDir: path.join(__dirname, "../backups"),
  },

  // Email/SMTP 配置
  email: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO || "michael.chuang@adlinktech.com",
  },

  // 其他配置
  app: {
    isDev: process.env.NODE_ENV === "development",
  }
};

/**
 * 驗證必要配置
 */
function validateConfig() {
  const missing = [];

  if (!config.telegram.token) missing.push("TELEGRAM_BOT_TOKEN");
  
  if (config.email.host && (!config.email.user || !config.email.pass)) {
    console.warn("⚠️ 注意：已設定 SMTP_HOST 但缺少使用者名稱或密碼，Email 功能可能無法運作。");
  }

  if (missing.length > 0) {
    console.error("❌ 缺少必要的環境變數：", missing.join(", "));
    console.error("請檢查 .env 檔案是否設定正確。");
    // 不一定要直接結束進程，但可以讓呼叫方知道
    return false;
  }

  // 確保輸出資料夾存在
  if (!fs.existsSync(config.paths.outputDir)) {
    fs.mkdirSync(config.paths.outputDir, { recursive: true });
  }

  return true;
}

module.exports = {
  config,
  validateConfig,
};
