const dns = require("dns").promises;
const { config } = require("./config");

async function isTelegramOnline(bot = null) {
  try {
    // 1. 基本 DNS 檢查
    await dns.lookup("api.telegram.org");
    
    // 2. 如果有傳入 bot 實例，嘗試調用 getMe 驗證 Token 效能與 API 回應
    if (bot) {
      await bot.getMe();
    }
    
    return true;
  } catch (err) {
    console.warn(`⚠️ Telegram 連線檢查失敗: ${err.message}`);
    return false;
  }
}

module.exports = { isTelegramOnline };