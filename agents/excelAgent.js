const excelTool = require('../tools/excelTool');
const ai = require('../core/ai');

class ExcelAgent {
    async handle(message) {
        console.log("[ExcelAgent] 執行最終強制版提取...");
        const issues = await excelTool.extractCriticalIssues();
        
        if (issues.length === 0) {
            return "結論：本次未發現符合條件的資料";
        }

        const systemPrompt = "你是一個專業的台灣 PM 助理。你的唯一任務是將提供的資料整理成等寬對齊的純文字表格。\n" +
        "【強制行為限制】\n" +
        "1. 禁止任何分析、解釋、推論。不要說『Based on...』、『It appears...』等廢話。\n" +
        "2. 語言：說明的文字（結論、表頭、分類）一律使用「繁體中文」。不可出現簡體中文。\n" +
        "3. 內容：Excel 原始內容保持英文，不可翻譯。\n" +
        "4. 格式：必須嚴格遵守以下格式，且確保表格非常整齊對齊。\n\n" +
        "結論：本次共發現 " + issues.length + " 項 Critical Issues\n\n" +
        "專案名稱 | 問題描述 | 類別 | 來源\n" +
        "---------|----------|------|------\n" +
        "(資料列，每一筆獨立一行，類別只能是 Thermal/EE/ME/Other)\n\n" +
        "資料 (JSON):\n" + JSON.stringify(issues).substring(0, 20000);

        const response = await ai.generate(message, systemPrompt);
        return response;
    }
}
module.exports = new ExcelAgent();
