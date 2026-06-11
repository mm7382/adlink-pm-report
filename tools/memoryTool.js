const fs = require('fs').promises;
const path = require('path');

class MemoryTool {
    constructor() {
        this.baseDir = path.join(__dirname, '../memory');
    }

    async readJSON(filename) {
        const filePath = path.join(this.baseDir, filename);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }

    async saveJSON(filename, data) {
        const filePath = path.join(this.baseDir, filename);
        try {
            await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
            return true;
        } catch (error) {
            console.error("[MemoryTool ERROR] " + error.message);
            return false;
        }
    }
}

module.exports = new MemoryTool();
