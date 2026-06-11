const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const dfd = require('danfojs-node');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class ExcelTool {
    constructor() {
        this.baseDir = process.env.WORK_DIR || '/Users/michaelchuang/AD';
        this.cache = null;
        this.dataframes = {};
        this.fileStats = {};
    }

    async scanAndLoad() {
        if (!fs.existsSync(this.baseDir)) return {};
        const files = fs.readdirSync(this.baseDir).filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'));
        let needsReload = false;
        for (const file of files) {
            const filePath = path.join(this.baseDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (!this.fileStats[file] || this.fileStats[file] !== stats.mtimeMs) {
                    needsReload = true;
                    this.fileStats[file] = stats.mtimeMs;
                }
            } catch (e) {}
        }
        if (needsReload || !this.cache || Object.keys(this.dataframes).length === 0) {
            this.cache = await this.loadAllExcel(files);
            await this.createDataFrames();
        }
        return this.cache;
    }

    async loadAllExcel(files) {
        const allData = {};
        for (const file of files) {
            const filePath = path.join(this.baseDir, file);
            let fileContent = null;
            try {
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.readFile(filePath);
                fileContent = {};
                workbook.eachSheet((worksheet) => {
                    const data = [];
                    const headers = [];
                    let headerRowIndex = 1;
                    for (let i = 1; i <= 20; i++) {
                        const row = worksheet.getRow(i);
                        if (row.values.some(v => v && /Project|Dept|BU|Eng/i.test(String(v)))) {
                            headerRowIndex = i;
                            break;
                        }
                    }
                    worksheet.getRow(headerRowIndex).eachCell({ includeEmpty: true }, (cell, colNumber) => {
                        headers[colNumber] = String(cell.text || cell.value || '').trim();
                    });
                    worksheet.eachRow((row, rowNumber) => {
                        if (rowNumber <= headerRowIndex) return;
                        const rowData = {};
                        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                            const header = headers[colNumber] || ("Col" + colNumber);
                            rowData[header] = String(cell.text || cell.value || '');
                        });
                        rowData["__meta_row"] = rowNumber;
                        data.push(rowData);
                    });
                    fileContent[worksheet.name] = data;
                });
            } catch (error) {
                try {
                    const workbook = XLSX.readFile(filePath);
                    fileContent = {};
                    workbook.SheetNames.forEach(sheetName => {
                        const worksheet = workbook.Sheets[sheetName];
                        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                        let headerIdx = 0;
                        for(let i=0; i < Math.min(rawData.length, 20); i++) {
                            if(rawData[i] && rawData[i].some(v => v && /Project|Dept|BU|Eng/i.test(String(v)))) {
                                headerIdx = i;
                                break;
                            }
                        }
                        const json = XLSX.utils.sheet_to_json(worksheet, { range: headerIdx });
                        fileContent[sheetName] = json.map((r, i) => {
                            r["__meta_row"] = (headerIdx + i + 2);
                            return r;
                        });
                    });
                } catch (e) {}
            }
            if (fileContent) allData[file] = fileContent;
        }
        return allData;
    }

    async createDataFrames() {
        this.dataframes = {};
        for (const [file, content] of Object.entries(this.cache)) {
            for (const [sheet, data] of Object.entries(content)) {
                if (Array.isArray(data) && data.length > 0) {
                    try { this.dataframes[file + " | " + sheet] = new dfd.DataFrame(data); } catch(e) {}
                }
            }
        }
    }

    async extractCriticalIssues() {
        await this.scanAndLoad();
        const results = [];
        const patterns = [/critical/i, /PEC/i, /ME issue/i, /thermal/i, /fail/i, /delay/i];
        const catPatterns = {
            Thermal: /thermal|溫度|散熱|Heat|Temp/i,
            EE: /EE|電路|Power|Sch|PCB|CAN bus|USB|BIOS/i,
            ME: /ME issue|機構|Chassis|Fan/i
        };
        for (const [sourceKey, df] of Object.entries(this.dataframes)) {
            const parts = sourceKey.split(" | ");
            const fileName = parts[0];
            const sheetName = parts[1];
            const rows = df.values;
            const columns = df.columns;
            rows.forEach((row) => {
                const rowObj = {};
                columns.forEach((col, idx) => { rowObj[col] = row[idx]; });
                const rowStr = JSON.stringify(rowObj);
                
                if (patterns.some(p => p.test(rowStr))) {
                    let category = "Other";
                    for (const [cat, p] of Object.entries(catPatterns)) {
                        if (p.test(rowStr)) { category = cat; break; }
                    }
                    const projCol = columns.find(c => /Project/i.test(c));
                    const projName = rowObj[projCol] || "N/A";
                    
                    const valuesOnly = Object.values(rowObj).filter(v => v && !String(v).includes('Row ') && String(v).length > 2);
                    if (valuesOnly.length > 0) {
                        results.push({
                            p: String(projName).trim(),
                            desc: Object.entries(rowObj)
                                .filter(([k, v]) => v && !k.startsWith("Col") && !k.startsWith("__") && !/^(OK|NA|-|null|undefined)$/i.test(String(v)))
                                .map(([k, v]) => k + ": " + v).join("; "),
                            cat: category,
                            src: fileName + " / " + sheetName + " / Row " + (rowObj["__meta_row"] || "N/A")
                        });
                    }
                }
            });
        }
        return results;
    }

    getDataSummary() {
        return "Sheets: " + Object.keys(this.dataframes).length;
    }
}

module.exports = new ExcelTool();
