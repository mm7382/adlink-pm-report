const fs = require('fs').promises;
const path = require('path');

class FileTool {
    async searchFiles(keyword, dirPath) {
        console.log("[FileTool] 正在目錄 " + dirPath + " 搜尋關鍵字: " + keyword);
        try {
            const files = await fs.readdir(dirPath);
            const matches = [];
            for (const file of files) {
                if (file.toLowerCase().includes(keyword.toLowerCase())) {
                    matches.push(file);
                }
            }
            return matches;
        } catch (error) {
            console.error("[FileTool ERROR] " + error.message);
            return [];
        }
    }

    async readFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        } catch (error) {
            return "無法讀取檔案: " + error.message;
        }
    }
}

module.exports = new FileTool();
