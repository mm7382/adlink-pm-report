const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { config } = require("./config");
const { criticalIssues } = require("./excelRules");

const PROJECT_DIR = path.join(__dirname, "..");
const OUTPUT_DIR = config.paths.outputDir;

const SEARCH_DIRS = [
  config.paths.scanTarget,
  path.join(PROJECT_DIR, "data"),
  path.join(PROJECT_DIR, "excel"),
  path.join(PROJECT_DIR, "files"),
];

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function isExcelFile(file) {
  return (
    file.endsWith(".xlsx") ||
    file.endsWith(".xls") ||
    file.endsWith(".xlsm")
  );
}

function findExcelFiles(dir) {
  let results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (
        item === "node_modules" ||
        item === ".git" ||
        item === "output"
      ) {
        continue;
      }

      results = results.concat(findExcelFiles(fullPath));
    } else if (isExcelFile(item)) {
      results.push(fullPath);
    }
  }

  return results;
}

function getAllExcelFiles() {
  const files = [];

  for (const dir of SEARCH_DIRS) {
    files.push(...findExcelFiles(dir));
  }

  return [...new Set(files)];
}

function cellText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function lowerText(value) {
  return cellText(value).toLowerCase();
}

function isCriticalIssueHeader(text) {
  const t = lowerText(text);
  const { headerKeywords, subKeywords } = criticalIssues;

  return (
    headerKeywords.some(k => t.includes(k)) &&
    subKeywords.some(k => t.includes(k))
  );
}

function isProjectNameText(text) {
  const t = lowerText(text);
  return criticalIssues.projectNameKeywords.some(k => t.includes(k));
}

function looksLikeHeader(text) {
  const t = lowerText(text);
  const allKeywords = [
    ...criticalIssues.headerKeywords,
    ...criticalIssues.subKeywords,
    ...criticalIssues.projectNameKeywords,
    ...criticalIssues.excludeKeywords
  ];

  return allKeywords.some(k => t.includes(k));
}

function findProjectName(rows, headerRowIndex, colIndex) {
  /**
   * 你的 Excel 邏輯：
   * 最上面一列有 Project Name，
   * Critical xxx open Issues 欄位對應到那一欄的真正 project name。
   */

  // 1. 優先往上找同一欄的專案名稱
  for (let r = headerRowIndex - 1; r >= 0; r--) {
    const value = cellText(rows[r]?.[colIndex]);

    if (
      value &&
      !isCriticalIssueHeader(value) &&
      !isProjectNameText(value) &&
      !looksLikeHeader(value)
    ) {
      return value;
    }
  }

  // 2. 如果同欄往上找不到，找附近欄位上方
  for (let r = headerRowIndex - 1; r >= 0; r--) {
    for (let c = Math.max(0, colIndex - 3); c <= colIndex + 3; c++) {
      const value = cellText(rows[r]?.[c]);

      if (
        value &&
        !isCriticalIssueHeader(value) &&
        !isProjectNameText(value) &&
        !looksLikeHeader(value)
      ) {
        return value;
      }
    }
  }

  // 3. 找 Project Name 欄位
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      const value = cellText(rows[r][c]);

      if (isProjectNameText(value)) {
        const rightValue = cellText(rows[r][c + 1]);
        const belowValue = cellText(rows[r + 1]?.[c]);

        if (rightValue && !looksLikeHeader(rightValue)) return rightValue;
        if (belowValue && !looksLikeHeader(belowValue)) return belowValue;
      }
    }
  }

  return "未找到 Project Name";
}

function collectIssues(rows, headerRowIndex, colIndex) {
  const issues = [];

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const value = cellText(rows[r]?.[colIndex]);

    if (!value) {
      continue;
    }

    if (isCriticalIssueHeader(value)) {
      break;
    }

    // 避免把其他欄位標題抓進去
    if (looksLikeHeader(value) && issues.length > 0) {
      break;
    }

    issues.push(value);
  }

  return issues;
}

function analyzeSheet(rows, fileName, sheetName) {
  const results = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];

    for (let c = 0; c < row.length; c++) {
      const header = cellText(row[c]);

      if (!isCriticalIssueHeader(header)) {
        continue;
      }

      const projectName = findProjectName(rows, r, c);
      const issues = collectIssues(rows, r, c);

      results.push({
        fileName,
        sheetName,
        projectName,
        header,
        issues,
      });
    }
  }

  return results;
}

function analyzeExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const fileName = path.basename(filePath);

  let allResults = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    const sheetResults = analyzeSheet(rows, fileName, sheetName);
    allResults = allResults.concat(sheetResults);
  }

  return allResults;
}

function buildDebugHeaders(excelFiles) {
  let debugText = "";

  debugText += "\n\n====================================\n";
  debugText += "Debug：前 20 列欄位內容\n";
  debugText += "====================================\n\n";

  for (const file of excelFiles) {
    try {
      const workbook = XLSX.readFile(file);
      debugText += `檔案：${file}\n`;

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          raw: false,
        });

        debugText += `Sheet：${sheetName}\n`;

        for (let r = 0; r < Math.min(rows.length, 20); r++) {
          const rowText = (rows[r] || [])
            .map((v, i) => `[${i}] ${cellText(v)}`)
            .filter((v) => !v.endsWith("] "))
            .join(" | ");

          if (rowText) {
            debugText += `Row ${r + 1}: ${rowText}\n`;
          }
        }

        debugText += "\n";
      }
    } catch (err) {
      debugText += `讀取失敗：${file}，原因：${err.message}\n\n`;
    }
  }

  return debugText;
}

function formatReport(command, excelFiles, analysisResults) {
  const now = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
  });

  let report = "";

  report += "ADLINK PM Agent 分析報告\n";
  report += "====================================\n\n";
  report += `分析時間：${now}\n`;
  report += `收到指令：${command}\n\n`;

  report += `找到 Excel 檔案數量：${excelFiles.length}\n\n`;

  excelFiles.forEach((file, index) => {
    report += `${index + 1}. ${file}\n`;
  });

  report += "\n====================================\n";
  report += "Critical Issues 分析結果\n";
  report += "====================================\n\n";

  if (analysisResults.length === 0) {
    report += "⚠️ 沒有找到 Critical Issues 相關欄位。\n\n";
    report += "我有找到 Excel，但沒有掃到符合條件的欄位。\n";
    report += "目前判斷條件是欄位名稱同時包含：Critical + Issue 或 Critical + Open。\n";
    report += "請看下方 Debug 欄位內容，確認實際欄位名稱。\n";

    report += buildDebugHeaders(excelFiles);

    return report;
  }

  analysisResults.forEach((item, index) => {
    report += `#${index + 1}\n`;
    report += `檔案：${item.fileName}\n`;
    report += `Sheet：${item.sheetName}\n`;
    report += `Project：${item.projectName}\n`;
    report += `欄位：${item.header}\n`;

    if (item.issues.length === 0) {
      report += "Critical Issues：目前沒有抓到內容\n";
    } else {
      report += "Critical Issues：\n";
      item.issues.forEach((issue, i) => {
        report += `${i + 1}. ${issue}\n`;
      });
    }

    report += "\n------------------------------------\n\n";
  });

  return report;
}

async function runPMAgent(command = "") {
  ensureOutputDir();

  const excelFiles = getAllExcelFiles();

  if (excelFiles.length === 0) {
    const result = `
⚠️ ADLINK PM Agent 找不到 Excel 檔案

目前有搜尋這些資料夾：

${SEARCH_DIRS.join("\n")}

目前收到的指令：
${command}

請把 Excel 放到以下其中一個資料夾：
1. /Users/michaelchuang/AD/ADLink_PM_bot/AD
2. /Users/michaelchuang/AD/ADLink_PM_bot/data
3. /Users/michaelchuang/AD/ADLink_PM_bot/excel
4. /Users/michaelchuang/AD

`;

    fs.writeFileSync(
      path.join(OUTPUT_DIR, "offline_report.txt"),
      result,
      "utf8"
    );

    return result;
  }

  let analysisResults = [];

  for (const file of excelFiles) {
    try {
      const result = analyzeExcelFile(file);
      analysisResults = analysisResults.concat(result);
    } catch (err) {
      analysisResults.push({
        fileName: path.basename(file),
        sheetName: "讀取失敗",
        projectName: "讀取失敗",
        header: "讀取失敗",
        issues: [`讀取失敗：${err.message}`],
      });
    }
  }

  const report = formatReport(command, excelFiles, analysisResults);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "offline_report.txt"),
    report,
    "utf8"
  );

  return report;
}

module.exports = { runPMAgent };