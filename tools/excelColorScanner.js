const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { colorScanner } = require("../core/excelRules");

function isExcelFile(fileName) {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xlsm");
}

function shouldSkipFolder(folderName) {
  return [
    "node_modules",
    ".git",
    "output",
    "backups",
    "ADLink_PM_bot_backup",
  ].includes(folderName);
}

function findExcelFiles(folderPath) {
  let files = [];

  if (!fs.existsSync(folderPath)) {
    return files;
  }

  const items = fs.readdirSync(folderPath);

  for (const item of items) {
    const fullPath = path.join(folderPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (shouldSkipFolder(item)) continue;
      files = files.concat(findExcelFiles(fullPath));
      continue;
    }

    if (isExcelFile(item)) {
      files.push(fullPath);
    }
  }

  return files;
}

function getCellText(cell) {
  const value = cell.value;

  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);

  if (typeof value === "object") {
    if (value.richText && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || "").join("").trim();
    }

    if (value.text) return String(value.text).trim();
    if (value.result) return String(value.result).trim();
    if (value.hyperlink && value.text) return String(value.text).trim();
  }

  return String(value).trim();
}

function getArgbColor(color) {
  if (!color) return "";

  if (color.argb) return color.argb.toUpperCase();
  if (color.rgb) return color.rgb.toUpperCase();
  if (color.theme !== undefined) return `theme:${color.theme}`;
  if (color.indexed !== undefined) return `indexed:${color.indexed}`;

  return "";
}

function normalizeColor(argb) {
  if (!argb) return "";

  const upper = String(argb).toUpperCase();

  if (upper.length === 8 && upper.startsWith("FF")) {
    return upper.slice(2);
  }

  return upper;
}

function isRedColor(argb) {
  const color = normalizeColor(argb);
  return colorScanner.colors.red.includes(color);
}

function isBlueColor(argb) {
  const color = normalizeColor(argb);
  return colorScanner.colors.blue.includes(color);
}

/**
 * 從規則中獲取目標欄位關鍵字
 */
const TARGET_COLUMN_KEYWORDS = colorScanner.targetColumns;

/**
 * 從規則中獲取分類規則
 */
const FOCUS_RULES = colorScanner.focusRules;


function normalizeSearchText(text) {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()} `;
}

function keywordMatched(normalizedText, keyword) {
  const key = String(keyword || "").toLowerCase().trim();

  if (!key) return false;

  /**
   * 避免短詞誤判：
   * 例如 me 不要命中 mechanical 裡面的 me。
   * se 不要命中 reset / reserved 之類單字。
   */
  if (/^[a-z]{1,3}$/.test(key)) {
    return normalizedText.includes(` ${key} `);
  }

  return normalizedText.includes(key);
}

function isTargetColumnHeader(text) {
  const normalized = normalizeSearchText(text);

  return TARGET_COLUMN_KEYWORDS.some((keyword) => {
    return keywordMatched(normalized, keyword);
  });
}

function getFocusMatches(text) {
  const normalized = normalizeSearchText(text);
  const tags = [];
  const keywords = [];
  const keywordMap = {};

  for (const rule of FOCUS_RULES) {
    const matchedKeywords = rule.keywords.filter((keyword) => {
      return keywordMatched(normalized, keyword);
    });

    if (matchedKeywords.length > 0) {
      tags.push(rule.tag);
      keywords.push(...matchedKeywords);
      keywordMap[rule.tag] = matchedKeywords;
    }
  }

  return {
    tags: [...new Set(tags)],
    keywords: [...new Set(keywords)],
    keywordMap,
  };
}

/**
 * 找出每個 worksheet 裡面的 Key Issue / Highlight / Escalation 欄位。
 * 每個分頁格式可能不同，所以掃前 30 列當作可能的 header 區。
 */
function findTargetColumns(worksheet) {
  const columns = new Map();
  const maxHeaderRows = Math.min(30, worksheet.rowCount || 30);
  const maxColumns = worksheet.columnCount || 80;

  for (let r = 1; r <= maxHeaderRows; r++) {
    for (let c = 1; c <= maxColumns; c++) {
      const text = getCellText(worksheet.getCell(r, c));

      if (!text) continue;

      if (isTargetColumnHeader(text)) {
        const existing = columns.get(c);

        if (!existing || r < existing.headerRow) {
          columns.set(c, {
            colNumber: c,
            headerRow: r,
            headerText: text,
          });
        }
      }
    }
  }

  return Array.from(columns.values());
}

function findProjectNameNearCell(worksheet, rowNumber, colNumber) {
  const row = worksheet.getRow(rowNumber);
  let candidate = "";

  /**
   * 先從同一列左邊找 Project 名稱。
   * 這是為了顯示用，不拿來分類。
   */
  row.eachCell({ includeEmpty: false }, (cell, currentCol) => {
    if (currentCol >= colNumber) return;

    const text = getCellText(cell);
    if (!text) return;

    const lower = text.toLowerCase();

    if (lower.includes("phase")) return;
    if (lower.includes("status")) return;
    if (lower.includes("dev")) return;
    if (lower.includes("dvt")) return;
    if (lower.includes("evt")) return;
    if (lower.includes("critical")) return;
    if (lower.includes("open")) return;
    if (lower.includes("key issue")) return;
    if (lower.includes("highlight")) return;
    if (lower.includes("escalation")) return;

    if (!candidate && text.length <= 120) {
      candidate = text;
    }
  });

  if (candidate) return candidate;

  /**
   * 找不到就往上找。
   * 這也是顯示用，不拿來分類。
   */
  for (let r = rowNumber - 1; r >= Math.max(1, rowNumber - 5); r--) {
    const text = getCellText(worksheet.getCell(r, colNumber));
    if (!text) continue;

    const lower = text.toLowerCase();

    if (lower.includes("status")) continue;
    if (lower.includes("critical")) continue;
    if (lower.includes("open")) continue;
    if (lower.includes("key issue")) continue;
    if (lower.includes("highlight")) continue;
    if (lower.includes("escalation")) continue;

    if (text.length <= 120) {
      return text;
    }
  }

  return worksheet.name || "未找到 Project";
}

function getRichTextColorMatches(cell) {
  const value = cell.value;

  if (!value || !value.richText || !Array.isArray(value.richText)) {
    return [];
  }

  const matches = [];

  for (const part of value.richText) {
    const text = part.text || "";
    const colorRaw = getArgbColor(part.font?.color);

    if (!text.trim()) continue;

    if (isRedColor(colorRaw)) {
      matches.push({
        type: "red",
        label: "紅字",
        text: text.trim(),
        colorRaw,
      });
    }

    if (isBlueColor(colorRaw)) {
      matches.push({
        type: "blue",
        label: "藍字",
        text: text.trim(),
        colorRaw,
      });
    }
  }

  return matches;
}

function getWholeCellColorMatch(cell) {
  const text = getCellText(cell);
  const colorRaw = getArgbColor(cell.font?.color);

  if (!text) return null;

  if (isRedColor(colorRaw)) {
    return {
      type: "red",
      label: "紅字",
      text,
      colorRaw,
    };
  }

  if (isBlueColor(colorRaw)) {
    return {
      type: "blue",
      label: "藍字",
      text,
      colorRaw,
    };
  }

  return null;
}

async function scanRedBlueFontCells(folderPath) {
  const files = findExcelFiles(folderPath);
  const results = [];

  for (const filePath of files) {
    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.readFile(filePath);
    } catch (err) {
      results.push({
        error: true,
        fileName: path.basename(filePath),
        filePath,
        message: `讀取失敗：${err.message}`,
      });
      continue;
    }

    workbook.eachSheet((worksheet) => {
      const targetColumns = findTargetColumns(worksheet);

      for (const targetColumn of targetColumns) {
        for (
          let rowNumber = targetColumn.headerRow + 1;
          rowNumber <= worksheet.rowCount;
          rowNumber++
        ) {
          const cell = worksheet.getCell(rowNumber, targetColumn.colNumber);
          const fullText = getCellText(cell);

          if (!fullText) continue;

          const richTextMatches = getRichTextColorMatches(cell);
          const wholeCellMatch = getWholeCellColorMatch(cell);

          let matches = [];

          if (richTextMatches.length > 0) {
            matches = richTextMatches;
          } else if (wholeCellMatch) {
            matches = [wholeCellMatch];
          }

          /**
           * 條件 1：
           * 該 Key Issue / Highlight / Escalation 儲存格本身要有紅字或藍字。
           */
          if (matches.length === 0) continue;

          /**
           * 條件 2：
           * 只用「該儲存格本身內容」判斷分類。
           *
           * 不使用：
           * - Project 名稱
           * - Sheet 名稱
           * - Excel 檔名
           *
           * 避免誤分類。
           */
          const focusContextText = [
            fullText,
            ...matches.map((m) => m.text),
          ].join(" ");

          const focus = getFocusMatches(focusContextText);

          if (focus.tags.length === 0) {
            continue;
          }

          const project = findProjectNameNearCell(
            worksheet,
            rowNumber,
            targetColumn.colNumber
          );

          results.push({
            error: false,
            fileName: path.basename(filePath),
            filePath,
            sheetName: worksheet.name,
            row: rowNumber,
            col: targetColumn.colNumber,
            cell: cell.address,
            project,
            fullText,
            matches,
            focusTags: focus.tags,
            focusKeywords: focus.keywords,
            focusKeywordMap: focus.keywordMap,
            columnHeader: targetColumn.headerText,
            columnHeaderRow: targetColumn.headerRow,
          });
        }
      }
    });
  }

  return results;
}

function formatRedBlueFontReport(results) {
  const validResults = (results || []).filter((item) => !item.error);
  const errorResults = (results || []).filter((item) => item.error);

  if (validResults.length === 0) {
    let msg = "";

    msg += "🎨 紅色 / 藍色字體分析\n\n";
    msg += "目前沒有找到符合條件的紅色或藍色字體內容。\n\n";
    msg += "目前只搜尋欄位：\n";
    msg += "- Key Issue\n";
    msg += "- Highlight\n";
    msg += "- Escalation\n\n";
    msg += "條件：\n";
    msg += "1. 該儲存格本身有紅字或藍字\n";
    msg += "2. 該儲存格本身文字有出現以下相關字眼：\n";
    msg += "   - ME / Mechanical / 機構\n";
    msg += "   - SED / SE / SIE\n";
    msg += "   - Thermal / 散熱\n";
    msg += "   - EMC / RF / Safety\n";

    if (errorResults.length > 0) {
      msg += "\n讀取失敗檔案：\n";

      errorResults.forEach((item) => {
        msg += `- ${item.fileName}: ${item.message}\n`;
      });
    }

    return [msg.trim()];
  }

  const messages = [];

  let header = "";
  header += "🎨 紅色 / 藍色字體分析\n\n";
  header += "搜尋欄位：Key Issue / Highlight / Escalation\n";
  header += "判斷方式：該儲存格本身有紅/藍字，且文字本身出現 ME / SED / Thermal / EMC/RF/Safety 相關字眼\n";
  header += `找到相關紅色 / 藍色字體儲存格：${validResults.length}\n`;

  if (errorResults.length > 0) {
    header += `讀取失敗檔案：${errorResults.length}\n`;
  }

  messages.push(header.trim());

  return messages;
}

module.exports = {
  scanRedBlueFontCells,
  formatRedBlueFontReport,
};