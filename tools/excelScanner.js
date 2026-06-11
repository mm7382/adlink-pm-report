const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const { criticalIssues } = require("../core/excelRules");

// 排除已完成的關鍵字
const EXCLUDE = ["done", "closed", "resolved", "fixed"];

// 從規則動態生成 Regex
const headerPattern = criticalIssues.headerKeywords.join("|");
const subPattern = criticalIssues.subKeywords.join("|");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toFlexibleKeywordPattern(value) {
  return String(value)
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
}

const catPattern = (criticalIssues.categories || [])
  .slice()
  .sort((a, b) => String(b).length - String(a).length)
  .map(toFlexibleKeywordPattern)
  .join("|");

// 嚴格的全域搜尋正規表達式
const CRITICAL_SCAN_REGEX = new RegExp(`(${headerPattern})\\s+(${catPattern})\\s+(${subPattern})\\s*[:：]?\\s*([\\s\\S]*?)(?=(${headerPattern})\\s+(${catPattern})\\s+(${subPattern})|$)`, "gi");

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\r\n\t]/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return cleanText(value).toLowerCase();
}

/**
 * 聰明的排除邏輯：
 * 只有當排除字眼是獨立單詞 (如 "Done") 或在開頭時才排除。
 * 避免誤殺 "Initial Done", "Fixed frequency" 等技術敘述。
 */
function isExcluded(text) {
  const lower = normalizeText(text);
  if (!lower) return false;

  // 1. 如果整個儲存格只有一個字且在排除名單內，排除
  if (EXCLUDE.includes(lower)) return true;

  // 2. 如果敘述很短且包含排除關鍵字詞組，排除
  if (lower.length < 20) {
    return EXCLUDE.some(k => lower.includes(k));
  }

  // 3. 針對長敘述，只有當關鍵字作為獨立狀態出現時才排除 (例如 "Status: Closed")
  return false; 
}

function normalizeForDuplicate(text) {
  return cleanText(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[，。,.]/g, "")
    .trim();
}

function isExcelFile(file) {
  const lower = file.toLowerCase();
  if (file.startsWith("~$")) return false;
  return lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm");
}

function findExcelFilesRecursive(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    let stat;
    try { stat = fs.statSync(fullPath); } catch (e) { continue; }
    if (stat.isDirectory()) {
      if (["node_modules", ".git", "output", "backups", "ADLink_PM_bot_backup"].includes(item)) continue;
      results = results.concat(findExcelFilesRecursive(fullPath));
    } else if (isExcelFile(item)) {
      results.push(fullPath);
    }
  }
  return results;
}

function isSheetHidden(workbook, sheetName) {
  const sheetsInfo = workbook?.Workbook?.Sheets || [];
  const info = sheetsInfo.find((s) => s.name === sheetName);
  return Number(info?.Hidden || 0) !== 0;
}

function isRowHidden(sheet, rowIndex) {
  const rowsInfo = sheet?.["!rows"] || [];
  const rowInfo = rowsInfo[rowIndex];
  return !!(rowInfo && rowInfo.hidden);
}

function isColHidden(sheet, colIndex) {
  const colsInfo = sheet?.["!cols"] || [];
  const colInfo = colsInfo[colIndex];
  return !!(colInfo && colInfo.hidden);
}

function normalizeCategory(category) {
  const raw = cleanText(category);
  const lower = raw.toLowerCase();
  if (lower.includes("bios")) return "BIOS";
  if (lower.includes("fw") || lower.includes("firmware")) return "FW";
  if (lower.includes("fpga")) return "FPGA";
  if (lower.includes("hw1")) return "HW1";
  if (lower.includes("hw2")) return "HW2";
  if (lower.includes("hw3")) return "HW3";
  if (lower.includes("hw4")) return "HW4";
  if (lower.includes("hw5")) return "HW5";
  if (lower.includes("hw6")) return "HW6";
  if (lower === "hw" || lower.includes("hardware")) return "HW";
  if (lower.includes("linux") && lower.includes("bsp")) return "Linux BSP";
  if (lower === "se") return "SE";
  if (lower.includes("sie") || lower.includes("sed")) return "SIE";
  if (lower.includes("me") || lower.includes("mechanical") || lower.includes("機構")) return "ME";
  if (lower.includes("thermal") || lower.includes("therma") || lower.includes("散熱")) return "Thermal";
  if (lower.includes("rf")) return "RF";
  if (lower.includes("peg")) return "PEG";
  if (lower.includes("emc")) return "EMC";
  if (lower.includes("safety")) return "Safety";
  if (lower.includes("sw") || lower.includes("software")) return "SW";
  if (lower.includes("pm")) return "PM";
  return raw || "Other";
}

function findProjectNameColumn(rows, sheet) {
  const projectKeywords = criticalIssues.projectNameKeywords;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    if (isRowHidden(sheet, r)) continue;
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (isColHidden(sheet, c)) continue;
      const cellText = normalizeText(row[c]);
      if (projectKeywords.some(k => cellText === k || cellText.includes(k))) {
        return { col: c, headerRow: r };
      }
    }
  }
  return { col: -1, headerRow: -1 };
}

function getProjectNameFromRow(row, projectCol, fallbackProjectName) {
  const val = projectCol >= 0 ? cleanText(row[projectCol]) : "";
  return val || fallbackProjectName || "N/A";
}

function extractCriticalItemsFromCell(text) {
  const value = cleanText(text);
  if (!/critical/i.test(value)) return [];

  const results = [];
  CRITICAL_SCAN_REGEX.lastIndex = 0;

  let match;
  while ((match = CRITICAL_SCAN_REGEX.exec(value)) !== null) {
    const category = normalizeCategory(match[2]);
    const title = `Critical ${category} open`;
    let detail = cleanText(match[4]);

    if (!detail) {
      detail = "(無敘述)";
    }

    const stopSymbols = ["**", "=>", "|"];
    for (const sym of stopSymbols) {
      if (detail.includes(sym)) detail = detail.split(sym)[0].trim();
    }

    if (detail.length > 1000) detail = detail.slice(0, 1000).trim() + " ...";
    
    // 執行優化後的排除檢查
    if (isExcluded(detail)) continue;

    results.push({
      category,
      title,
      detail,
      description: `${title}：${detail}`,
    });
  }
  return results;
}

function makeDuplicateKey(projectName, category, description, source) {
  return [
    normalizeForDuplicate(projectName),
    normalizeForDuplicate(category),
    normalizeForDuplicate(description),
    normalizeForDuplicate(source),
  ].join("__");
}

function addResult(results, seen, item) {
  const key = makeDuplicateKey(item.project, item.category, item.description, item.source);
  if (seen.has(key)) return;
  seen.add(key);
  results.push(item);
}

function scanExcelFolder(folderPath) {
  const results = [];
  const seen = new Set();
  if (!fs.existsSync(folderPath)) return results;

  console.log(`📁 掃描目錄：${folderPath} (遞迴搜尋模式)`);
  const allFiles = findExcelFilesRecursive(folderPath);
  console.log(`📊 找到 ${allFiles.length} 個 Excel 檔案`);

  allFiles.forEach((fullPath) => {
    const file = path.basename(fullPath);
    let workbook;
    try {
      workbook = XLSX.readFile(fullPath, { cellStyles: true });
    } catch (err) {
      console.log(`❌ 讀取失敗：${file} / ${err.message}`);
      return;
    }
    workbook.SheetNames.forEach((sheetName) => {
      if (isSheetHidden(workbook, sheetName)) return;
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      if (!rows || rows.length === 0) return;
      const projectInfo = findProjectNameColumn(rows, sheet);
      const projectCol = projectInfo.col;
      let lastProjectName = "";
      rows.forEach((row, rowIndex) => {
        if (!row || isRowHidden(sheet, rowIndex)) return;
        const currentProjectName = (projectCol >= 0 && !isColHidden(sheet, projectCol)) ? cleanText(row[projectCol]) : "";
        if (currentProjectName) lastProjectName = currentProjectName;
        const projectName = getProjectNameFromRow(row, projectCol, lastProjectName);
        row.forEach((cell, colIndex) => {
          if (isColHidden(sheet, colIndex)) return;
          const cellText = cleanText(cell);
          if (!cellText) return;
          const items = extractCriticalItemsFromCell(cellText);
          items.forEach((item) => {
            addResult(results, seen, {
              project: projectName,
              category: item.category,
              title: item.title,
              detail: item.detail,
              description: item.description,
              source: `${file} / ${sheetName} / Row ${rowIndex + 1}`,
            });
          });
        });
      });
    });
  });
  return results;
}

function groupResultsByCategory(results) {
  const order = criticalIssues.categories;
  const map = new Map();
  results.forEach((item) => {
    const category = item.category || "Other";
    if (!map.has(category)) map.set(category, []);
    map.get(category).push(item);
  });
  return Array.from(map.entries()).sort((a, b) => {
    const ai = order.indexOf(a[0]);
    const bi = order.indexOf(b[0]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || String(a[0]).localeCompare(String(b[0]));
  });
}

function formatCriticalIssues(results) {
  if (!results.length) return ["結論：沒有符合 Critical xxx open 的問題"];
  const top = results.slice(0, 80);
  const grouped = groupResultsByCategory(top);
  let text = `📊 Critical xxx open Issues\n共找到 ${results.length} 筆\n\n`;
  grouped.forEach(([category, items]) => {
    text += `====================\n分類：${category}\n====================\n\n`;
    items.forEach((i, idx) => {
      text += `#${idx + 1}\nProject: 📦 ${i.project}\n${i.description}\n\n🏷 ${i.source}\n\n`;
    });
  });
  return splitTelegramMessages(text);
}

function splitTelegramMessages(text) {
  const maxLength = 3500;
  const messages = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cutIndex = remaining.lastIndexOf("\n\n", maxLength);
    if (cutIndex <= 0) cutIndex = maxLength;
    messages.push(remaining.slice(0, cutIndex).trim());
    remaining = remaining.slice(cutIndex).trim();
  }
  if (remaining) messages.push(remaining);
  return messages;
}

module.exports = { scanExcelFolder, formatCriticalIssues, isSheetHidden, isRowHidden, isColHidden };
