require("dotenv").config();

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const nodemailer = require("nodemailer");
const { exec } = require("child_process");

const { config, validateConfig } = require("./core/config");
const { scanExcelFolder } = require("./tools/excelScanner");
const { generateCriticalIssuesHtml } = require("./tools/htmlReport");

const EXCEL_FOLDER = config.paths.scanTarget;
const MAIL_TO = config.email.to;
const OUTPUT_DIR = config.paths.outputDir;

const REPORT_PATH = path.join(OUTPUT_DIR, "offline_report.txt");
const PENDING_MAIL_PATH = path.join(OUTPUT_DIR, "pending_mail.txt");

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function createMailer() {
  if (!config.email.host || !config.email.user || !config.email.pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
}

async function sendReportMail(reportText) {
  const transporter = createMailer();

  if (!transporter) {
    throw new Error("SMTP 尚未設定，無法寄信");
  }

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: MAIL_TO,
    subject: "Critical xxx open Issues",
    text: reportText,
  });
}

function formatFullCriticalReport(results) {
  if (!results || results.length === 0) {
    return "結論：沒有符合 Critical xxx open 的問題";
  }

  let text = `📊 Critical xxx open Issues\n`;
  text += `共找到 ${results.length} 筆\n\n`;

  results.forEach((item, index) => {
    text += `#${index + 1}\n`;
    text += `Project: ${item.project || "N/A"}\n`;
    text += `${item.description || ""}\n`;
    text += `Source: ${item.source || ""}\n\n`;
  });

  return text;
}

function runCriticalIssues() {
  ensureOutputDir();

  console.log(`📁 正在掃描 Excel 資料夾：${EXCEL_FOLDER}`);

  const results = scanExcelFolder(EXCEL_FOLDER);
  const fullReport = formatFullCriticalReport(results);

  fs.writeFileSync(REPORT_PATH, fullReport, "utf8");

  const htmlPath = generateCriticalIssuesHtml(results);

  return {
    results,
    fullReport,
    htmlPath,
  };
}

function openHtmlFile(htmlPath) {
  if (!htmlPath) return;

  exec(`open "${htmlPath}"`, (err) => {
    if (err) {
      console.log(`HTML 報告已產生，但無法自動開啟：${htmlPath}`);
    }
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function main() {
  console.log("🟢 ADLINK PM Agent 離線模式已啟動");
  console.log("這個模式不需要 Telegram。");
  console.log("");
  console.log("功能：");
  console.log("1. 掃描 Critical Issues");
  console.log("2. 產生 output/offline_report.txt");
  console.log("3. 產生 output/critical_issues_report_YYYYMMDD.html");
  console.log("4. 自動用瀏覽器打開 HTML 報告");
  console.log("5. 可選擇是否寄出 Email");
  console.log("");
  console.log(`📁 Excel 掃描資料夾：${EXCEL_FOLDER}`);
  console.log("");

  try {
    const input = await ask("請輸入指令，或直接按 Enter 執行 Critical Issues > ");

    if (input.trim().toLowerCase() === "exit") {
      console.log("已離開。");
      rl.close();
      return;
    }

    console.log("");
    console.log("正在掃描 Excel，請稍候...");
    console.log("");

    const { results, fullReport, htmlPath } = runCriticalIssues();

    console.log(`✅ 掃描完成，共找到 ${results.length} 筆 Critical Issues。`);
    console.log(`文字報告已輸出：${REPORT_PATH}`);
    console.log(`HTML 報告已輸出：${htmlPath}`);

    openHtmlFile(htmlPath);

    console.log("");
    console.log("請確認是否要寄出 Email？");

    const confirm = await ask("輸入 y 寄出，其他按鍵取消 > ");

    if (confirm.trim().toLowerCase() !== "y") {
      console.log("已取消寄信。");
      console.log(`報告已輸出：${REPORT_PATH}`);
      console.log(`HTML 報告已輸出：${htmlPath}`);
      rl.close();
      return;
    }

    try {
      console.log("正在寄出 Email，請稍候...");
      await sendReportMail(fullReport);
      console.log(`Email 已寄出：${MAIL_TO}`);
    } catch (err) {
      console.log(`寄信失敗：${err.message}`);
      console.log("已將待寄內容暫存，等網路或 SMTP 正常後可再處理。");

      fs.writeFileSync(PENDING_MAIL_PATH, fullReport, "utf8");
      console.log(`待寄內容：${PENDING_MAIL_PATH}`);
    }

    console.log(`報告已輸出：${REPORT_PATH}`);
    console.log(`HTML 報告已輸出：${htmlPath}`);
  } catch (err) {
    console.error("發生錯誤：", err.message);
    console.log("請檢查 Excel 檔案或 tools/excelScanner.js 設定。");
  } finally {
    rl.close();
  }
}

main();
