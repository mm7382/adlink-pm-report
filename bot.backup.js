const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const { isTelegramOnline } = require("./core/telegramHealth");
const { runPMAgent } = require("./core/pmAgent");

const token = process.env.TELEGRAM_BOT_TOKEN;

async function main() {
  console.log("🔍 正在檢查 Telegram 連線...");

  const online = await isTelegramOnline();

  if (!online) {
    console.log("⚠️ Telegram 無法連線");
    console.log("原因可能是：");
    console.log("1. 目前沒有網路");
    console.log("2. DNS 找不到 api.telegram.org");
    console.log("3. 公司網路或 VPN 擋 Telegram");
    console.log("");
    console.log("✅ ADLINK PM Agent 核心仍可離線使用");
    console.log("請改用：");
    console.log("");
    console.log("node local.js");
    console.log("");
    process.exit(0);
  }

  if (!token) {
    console.log("❌ 找不到 TELEGRAM_BOT_TOKEN");
    console.log("請確認 .env 裡面有設定 TELEGRAM_BOT_TOKEN");
    process.exit(1);
  }

  const bot = new TelegramBot(token, {
    polling: true,
  });

  console.log("🟢 Telegram Bot 已啟動...");

  bot.on("polling_error", (err) => {
    console.log("⚠️ Telegram polling 發生錯誤：", err.message);
    console.log("如果一直出現，請按 Ctrl + C 停止，改用 node local.js");
  });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(
      chatId,
      "我是 ADLINK PM Agent。\n\n你可以輸入：\n分析 AD 資料夾 Excel"
    );
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || "";

    if (text.startsWith("/start")) {
      return;
    }

    if (!text.trim()) {
      await bot.sendMessage(chatId, "請輸入文字指令，例如：分析 AD 資料夾 Excel");
      return;
    }

    try {
      await bot.sendMessage(chatId, "🧠 正在分析 AD 資料夾 Excel，請稍等...");

      const result = await runPMAgent(text);

      await bot.sendMessage(chatId, result);
    } catch (err) {
      console.error(err);
      await bot.sendMessage(chatId, `❌ 分析失敗：${err.message}`);
    }
  });
}

main();