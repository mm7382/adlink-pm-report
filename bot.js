require("dotenv").config();

const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const nodemailer = require("nodemailer");
const { exec } = require("child_process");

const { config, validateConfig } = require("./core/config");
const ai = require("./core/ai");
const { isTelegramOnline } = require("./core/telegramHealth");
const { scanExcelFolder } = require("./tools/excelScanner");
const { generateCriticalIssuesHtml } = require("./tools/htmlReport");
const { createStableBackup, restoreStableBackup } = require("./tools/backupManager");
const { answerWikiChat, ensureWikiChat } = require("./core/wikiChat");

const {
  scanRedBlueFontCells,
} = require("./tools/excelColorScanner");

const {
  generateRedBlueFontHtml,
} = require("./tools/colorHtmlReport");

// 執行配置驗證
if (!validateConfig()) {
  process.exit(1);
}

const token = config.telegram.token;
const EXCEL_FOLDER = config.paths.scanTarget;
const MAIL_TO = config.email.to;

// 暫存每個 chat 最新 report
const latestReports = {};
const wikiChatConfig = {
  projectRoot: __dirname,
  botName: "ADLink_PM",
  domain: "你熟悉 ADLink PM 專案狀態、Excel/Numbers 掃描、Critical Issues、紅藍字體報告、Email 報告與備份還原流程。",
};
ensureWikiChat(wikiChatConfig);

function isSupportedExcelFile(fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  return [".xlsx", ".xls", ".xlsm"].includes(ext);
}

function sanitizeFileName(fileName) {
  const parsed = path.parse(fileName || "uploaded_excel.xlsx");
  const safeName = parsed.name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "uploaded_excel";
  const safeExt = parsed.ext || ".xlsx";

  return `${safeName}${safeExt}`;
}

function getAvailableFilePath(dir, fileName) {
  const safeFileName = sanitizeFileName(fileName);
  const parsed = path.parse(safeFileName);
  let targetPath = path.join(dir, safeFileName);

  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  targetPath = path.join(dir, `${parsed.name}_${stamp}${parsed.ext}`);
  let index = 2;

  while (fs.existsSync(targetPath)) {
    targetPath = path.join(dir, `${parsed.name}_${stamp}_${index}${parsed.ext}`);
    index += 1;
  }

  return targetPath;
}

async function saveTelegramExcelDocument(bot, msg) {
  const document = msg.document;
  const fileName = document?.file_name || "";

  if (!document) {
    return null;
  }

  if (!isSupportedExcelFile(fileName)) {
    return {
      ok: false,
      message: [
        "我收到檔案了，但目前只支援 Excel：",
        ".xlsx / .xls / .xlsm",
        "",
        `收到的檔名：${fileName || "未命名檔案"}`,
      ].join("\n"),
    };
  }

  fs.mkdirSync(EXCEL_FOLDER, { recursive: true });

  const targetPath = getAvailableFilePath(EXCEL_FOLDER, fileName);
  const tempDir = fs.mkdtempSync(path.join(config.paths.outputDir, "telegram-upload-"));
  const downloadedPath = await bot.downloadFile(document.file_id, tempDir);

  try {
    fs.renameSync(downloadedPath, targetPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    ok: true,
    fileName: path.basename(targetPath),
    path: targetPath,
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

async function sendReportMail(reportText, htmlPath) {
  const transporter = createMailer();

  if (!transporter) {
    throw new Error("SMTP 尚未設定，無法寄信。請檢查 .env 檔案。");
  }

  const attachments = [];

  if (htmlPath && fs.existsSync(htmlPath)) {
    attachments.push({
      filename: path.basename(htmlPath),
      path: htmlPath,
      contentType: "text/html",
    });
  }

  await transporter.sendMail({
    from: config.email.from,
    to: MAIL_TO,
    subject: "Critical xxx open Issues",
    text: reportText,
    attachments,
  });
}

function runCriticalIssues() {
  console.log(`📁 正在掃描 Excel 資料夾：${EXCEL_FOLDER}`);

  const results = scanExcelFolder(EXCEL_FOLDER);

  // HTML 直接吃完整 results，不再吃 Telegram messages
  const htmlPath = generateCriticalIssuesHtml(results);

  const fullReport = formatFullCriticalReport(results);

  return {
    results,
    fullReport,
    htmlPath,
  };
}

async function sendCriticalIssuesReport(bot, chatId) {
  await bot.sendMessage(
    chatId,
    [
      "正在掃描 AD 資料夾中的 Excel，請稍候...",
      "",
      `📁 ${EXCEL_FOLDER}`,
    ].join("\n")
  );

  const { results, fullReport, htmlPath } = runCriticalIssues();

  latestReports[chatId] = {
    text: fullReport,
    htmlPath,
    count: results.length,
  };

  openHtmlFile(htmlPath);

  await bot.sendMessage(
    chatId,
    [
      "✅ 掃描完成。",
      "",
      `共找到 ${results.length} 筆 Critical Issues。`,
      "",
      "HTML 報告已產生：",
      htmlPath,
      "",
      "結果已整理在 HTML 裡，Telegram 不再顯示明細。",
    ].join("\n")
  );

  await bot.sendMessage(chatId, "是否要寄出 Email？", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ 確認寄出", callback_data: "SEND_CRITICAL_MAIL" },
          { text: "❌ 不寄出", callback_data: "CANCEL_CRITICAL_MAIL" },
        ],
      ],
    },
  });
}

async function runRedBlueFontHtmlReport() {
  console.log(`📁 正在掃描 Excel 資料夾：${EXCEL_FOLDER}`);

  const results = await scanRedBlueFontCells(EXCEL_FOLDER);
  const htmlPath = generateRedBlueFontHtml(results);

  return {
    results,
    htmlPath,
  };
}

async function sendRedBlueFontReport(bot, chatId) {
  await bot.sendMessage(
    chatId,
    [
      "正在掃描 AD 資料夾中的 Excel 紅色 / 藍色字體，請稍候...",
      "",
      `📁 ${EXCEL_FOLDER}`,
    ].join("\n")
  );

  const { results, htmlPath } = await runRedBlueFontHtmlReport();

  openHtmlFile(htmlPath);

  await bot.sendMessage(
    chatId,
    [
      "✅ 紅藍字體掃描完成。",
      "",
      `共找到 ${results.length} 筆結果。`,
      "",
      "HTML 報告已產生：",
      htmlPath,
      "",
      "結果已整理在 HTML 裡，Telegram 不再顯示明細。",
    ].join("\n")
  );
}

async function main() {
  console.log("🔍 正在檢查 Telegram 連線...");
  console.log(`📁 Excel 掃描資料夾：${EXCEL_FOLDER}`);

  const online = await isTelegramOnline();

  if (!online) {
    console.log("⚠️ Telegram 無法連線，所以 bot.js 不會啟動 polling。");
    console.log("這不是 Excel agent 壞掉，是 Telegram API 目前連不到。");
    console.log("");
    console.log("✅ 你仍然可以用離線模式執行：");
    console.log("");
    console.log("node local.js");
    console.log("");
    process.exit(0);
  }

  const bot = new TelegramBot(token, { polling: true });

  // 再次驗證 Token 是否有效
  const botInfo = await isTelegramOnline(bot);
  if (!botInfo) {
    console.error("❌ Telegram Token 無效，請確認 .env 設定。");
    process.exit(1);
  }

  console.log("🤖 Bot 已啟動...");


  bot.on("polling_error", (err) => {
    console.log("⚠️ Telegram polling 錯誤：", err.message);
    console.log("如果一直出現，請按 Ctrl + C 停止，改用 node local.js");
  });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(chatId, "請選擇功能：", {
      reply_markup: {
        keyboard: [
          ["📊 Critical Issues", "🎨 紅藍字體"],
          ["💾 建立備份", "🧩 還原備份"],
          ["💬 知識聊天", "🧠 記憶"],
        ],
        resize_keyboard: true,
      },
    });
  });

  bot.onText(/\/chatid/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      [
        "你的 Telegram chat id：",
        String(msg.chat.id),
        "",
        "把這個值設定到 Web server 的 TELEGRAM_NOTIFY_CHAT_ID，就可以收到登入與報告通知。",
      ].join("\n")
    );
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (msg.document) {
      try {
        await bot.sendChatAction(chatId, "upload_document");

        const saved = await saveTelegramExcelDocument(bot, msg);

        if (!saved.ok) {
          await bot.sendMessage(chatId, saved.message);
          return;
        }

        await bot.sendMessage(
          chatId,
          [
            "✅ Excel 已下載到 AD 資料夾。",
            "",
            `檔名：${saved.fileName}`,
            `位置：${saved.path}`,
            "",
            "現在可以直接分析這份檔案所在的 AD 資料夾。",
          ].join("\n"),
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📊 立即掃 Critical Issues", callback_data: "RUN_CRITICAL_ISSUES" },
                ],
                [
                  { text: "🎨 立即掃紅藍字體", callback_data: "RUN_RED_BLUE_FONT" },
                ],
              ],
            },
          }
        );
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `下載 Excel 失敗：${err.message}`);
      }

      return;
    }

    if (text === "/start" || text === "/chatid") {
      return;
    }

    if (text === "💬 知識聊天") {
      await bot.sendMessage(chatId, "你可以直接問我 ADLink PM、Excel 報告、Critical Issues、紅藍字體或備份流程。也可以用 /chat 你的問題，或 /tools 看我會用哪些工具。");
      return;
    }

    if (text === "🧠 記憶") {
      await bot.sendChatAction(chatId, "typing");
      await bot.sendMessage(chatId, await answerWikiChat(wikiChatConfig, "/memory", { chatId, user: msg.from?.username || msg.from?.id }));
      return;
    }

    if (text === "💾 建立備份" || text === "建立備份") {
      await bot.sendMessage(chatId, "⚠️ 你確定要把目前版本建立成 stable 備份嗎？", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ 確認建立備份", callback_data: "CREATE_STABLE_BACKUP" },
              { text: "❌ 取消", callback_data: "CANCEL_BACKUP" },
            ],
          ],
        },
      });

      return;
    }

    if (text === "🧩 還原備份" || text === "還原備份") {
      await bot.sendMessage(chatId, "⚠️ 你確定要還原到 stable 備份版本嗎？", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ 確認還原", callback_data: "RESTORE_STABLE_BACKUP" },
              { text: "❌ 取消", callback_data: "CANCEL_RESTORE_BACKUP" },
            ],
          ],
        },
      });

      return;
    }

    if (text === "📊 Critical Issues" || text === "Critical Issues") {
      try {
        await sendCriticalIssuesReport(bot, chatId);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `發生錯誤，請檢查 Excel 檔案或程式設定：${err.message}`);
      }

      return;
    }

    if (
      text === "🎨 紅藍字體" ||
      text === "紅藍字體" ||
      text === "紅色藍色字體"
    ) {
      try {
        await sendRedBlueFontReport(bot, chatId);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `紅藍字體分析失敗：${err.message}`);
      }

      return;
    }

    await bot.sendChatAction(chatId, "typing");
    const thinking = await bot.sendMessage(chatId, "我正在查 ADLink_PM 知識庫和最近記憶，稍等一下...");
    const answer = await answerWikiChat(wikiChatConfig, text, {
      chatId,
      user: msg.from?.username || msg.from?.id,
      generate: (prompt, systemPrompt) => ai.generate(prompt, systemPrompt),
    });
    await bot.deleteMessage(chatId, thinking.message_id).catch(() => {});
    await bot.sendMessage(chatId, answer);
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;

    if (action === "RUN_CRITICAL_ISSUES") {
      await bot.answerCallbackQuery(query.id);

      try {
        await sendCriticalIssuesReport(bot, chatId);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `發生錯誤，請檢查 Excel 檔案或程式設定：${err.message}`);
      }

      return;
    }

    if (action === "RUN_RED_BLUE_FONT") {
      await bot.answerCallbackQuery(query.id);

      try {
        await sendRedBlueFontReport(bot, chatId);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `紅藍字體分析失敗：${err.message}`);
      }

      return;
    }

    if (action === "CANCEL_BACKUP") {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, "已取消建立備份。");
      return;
    }

    if (action === "CREATE_STABLE_BACKUP") {
      await bot.answerCallbackQuery(query.id);

      try {
        await bot.sendMessage(chatId, "正在建立 stable 備份，請稍候...");

        const result = createStableBackup();

        await bot.sendMessage(chatId, result.message);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `建立備份失敗：${err.message}`);
      }

      return;
    }

    if (action === "CANCEL_RESTORE_BACKUP") {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, "已取消還原。");
      return;
    }

    if (action === "RESTORE_STABLE_BACKUP") {
      await bot.answerCallbackQuery(query.id);

      try {
        await bot.sendMessage(chatId, "正在還原 stable 備份版本，請稍候...");

        const result = restoreStableBackup();

        await bot.sendMessage(chatId, result.message);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `還原失敗：${err.message}`);
      }

      return;
    }

    if (action === "CANCEL_CRITICAL_MAIL") {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, "已取消寄信。");
      return;
    }

    if (action === "SEND_CRITICAL_MAIL") {
      await bot.answerCallbackQuery(query.id);

      try {
        const report = latestReports[chatId];

        if (!report) {
          await bot.sendMessage(chatId, "找不到可寄出的報告，請重新執行 Critical Issues。");
          return;
        }

        await bot.sendMessage(chatId, "正在寄出 Email，請稍候...");

        await sendReportMail(report.text, report.htmlPath);

        await bot.sendMessage(
          chatId,
          [
            `Email 已寄出：${MAIL_TO}`,
            "",
            `已附上 HTML 報告：${path.basename(report.htmlPath)}`,
          ].join("\n")
        );
      } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, `寄信失敗：${err.message}`);
      }

      return;
    }
  });
}

main();
