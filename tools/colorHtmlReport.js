const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "../output");

function getTaipeiDateStamp() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date()).replace(/-/g, "");
}

function getOutputHtmlPath(outputDir = OUTPUT_DIR) {
  return path.join(outputDir, `red_blue_font_report_${getTaipeiDateStamp()}.html`);
}

function ensureOutputDir(outputDir = OUTPUT_DIR) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(text) {
  return escapeHtml(String(text || ""));
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSource(sourceLine) {
  const clean = String(sourceLine || "")
    .replace(/^🏷\s*/, "")
    .replace(/^🏷️\s*/, "")
    .trim();

  const parts = clean.split("/").map((p) => p.trim());

  return {
    raw: clean,
    file: parts[0] || "",
    sheet: parts[1] || "",
    row: parts[2] || "",
  };
}

function normalizeCategory(rawCategory) {
  const raw = cleanText(rawCategory);
  const lower = raw.toLowerCase();

  if (lower.includes("bios")) return "BIOS";
  if (lower.includes("fw") || lower.includes("firmware")) return "FW";

  if (lower.includes("hw1")) return "HW1";
  if (lower.includes("hw2")) return "HW2";
  if (lower.includes("hw3")) return "HW3";
  if (lower.includes("hw4")) return "HW4";
  if (lower.includes("hw5")) return "HW5";
  if (lower === "hw" || lower.includes("hardware")) return "HW";

  if (lower.includes("sie") || lower.includes("sed") || lower === "se") {
    return "SIE";
  }

  if (
    lower.includes("me") ||
    lower.includes("mechanical") ||
    lower.includes("機構")
  ) {
    return "ME";
  }

  if (
    lower.includes("thermal") ||
    lower.includes("therma") ||
    lower.includes("散熱") ||
    lower.includes("溫度")
  ) {
    return "Thermal";
  }

  if (lower.includes("rf")) return "RF";
  if (lower.includes("peg")) return "PEG";
  if (lower.includes("emc")) return "EMC";
  if (lower.includes("safety")) return "Safety";
  if (lower.includes("sw") || lower.includes("software")) return "SW";
  if (lower.includes("pm")) return "PM";

  return raw || "Other";
}

function getCategoryFromIssue(issueText) {
  const issue = cleanText(issueText);
  const match = issue.match(/critical\s+(.+?)\s+open/i);

  if (!match) return "Other";

  return normalizeCategory(match[1]);
}

function getCategoryOrder(category) {
  const order = [
    "BIOS",
    "FW",
    "HW1",
    "HW2",
    "HW3",
    "HW4",
    "HW5",
    "HW",
    "SIE",
    "ME",
    "Thermal",
    "RF",
    "PEG",
    "EMC",
    "Safety",
    "SW",
    "PM",
    "Other",
  ];

  const index = order.indexOf(category);
  return index === -1 ? 999 : index;
}

function normalizeResultItem(item) {
  const source = parseSource(item.source || "");

  const issue =
    item.description ||
    (item.title && item.detail ? `${item.title}：${item.detail}` : "") ||
    item.detail ||
    "";

  const category = normalizeCategory(
    item.category || getCategoryFromIssue(issue)
  );

  return {
    project: item.project || "未命名 Project",
    issue,
    category,
    source,
  };
}

function getUniqueCategories(items) {
  const set = new Set();

  items.forEach((item) => {
    if (item.category) {
      set.add(item.category);
    }
  });

  return Array.from(set).sort((a, b) => {
    const orderA = getCategoryOrder(a);
    const orderB = getCategoryOrder(b);

    if (orderA !== orderB) return orderA - orderB;

    return String(a).localeCompare(String(b));
  });
}

function getUniqueFiles(items) {
  const set = new Set();

  items.forEach((item) => {
    if (item.source && item.source.file) {
      set.add(item.source.file);
    }
  });

  return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
}

function generateCategoryOptions(categories) {
  return categories
    .map((category) => {
      return `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`;
    })
    .join("\n");
}

function generateFileOptions(files) {
  return files
    .map((file) => {
      return `<option value="${escapeAttr(file)}">${escapeHtml(file)}</option>`;
    })
    .join("\n");
}

function generateRedBlueFontHtml(results, options = {}) {
  const outputDir = options.outputDir || OUTPUT_DIR;
  ensureOutputDir(outputDir);

  const now = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
  });

  const items = (results || []).map(normalizeResultItem);
  const categories = getUniqueCategories(items);
  const files = getUniqueFiles(items);

  const categoryCounts = {};
  const fileCounts = {};

  items.forEach((item) => {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;

    const fileName = item.source.file || "Unknown";
    fileCounts[fileName] = (fileCounts[fileName] || 0) + 1;
  });

  const categorySummaryHtml = categories
    .map((category) => {
      return `
        <span class="categoryCount">
          ${escapeHtml(category)}：${categoryCounts[category] || 0}
        </span>
      `;
    })
    .join("\n");

  const fileSummaryHtml = files
    .map((file) => {
      return `
        <span class="fileCount">
          ${escapeHtml(file)}：${fileCounts[file] || 0}
        </span>
      `;
    })
    .join("\n");

  const cardsHtml = items
    .map((item, index) => {
      const searchText = [
        item.category,
        item.project,
        item.issue,
        item.source.file,
        item.source.sheet,
        item.source.row,
        item.source.raw,
      ].join(" ");

      return `
        <section
          class="card"
          data-category="${escapeAttr(item.category)}"
          data-file="${escapeAttr(item.source.file || "")}"
          data-search="${escapeAttr(searchText.toLowerCase())}"
        >
          <div class="cardTop">
            <div class="badge">#${index + 1}</div>
            <div class="categoryPill">${escapeHtml(item.category)}</div>
            <div class="project">📦 ${escapeHtml(String(item.project).replace(/^📦\s*/, ""))}</div>
          </div>

          <div class="issueTitle">Critical Issue</div>
          <div class="issue">
            ${escapeHtml(item.issue).replace(/\n/g, "<br>")}
          </div>

          <div class="metaGrid">
            <div class="metaBox">
              <div class="metaLabel">Excel File</div>
              <div class="metaValue">${escapeHtml(item.source.file || item.source.raw || "-")}</div>
            </div>

            <div class="metaBox">
              <div class="metaLabel">Sheet</div>
              <div class="metaValue">${escapeHtml(item.source.sheet || "-")}</div>
            </div>

            <div class="metaBox">
              <div class="metaLabel">Row</div>
              <div class="metaValue">${escapeHtml(item.source.row || "-")}</div>
            </div>
          </div>

          <div class="source">
            🏷 ${escapeHtml(item.source.raw || "-")}
          </div>
        </section>
      `;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <title>ADLINK PM Agent - Red / Blue Font Report</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", Arial, sans-serif;
      background: #f4f6f7;
      color: #1b1f24;
    }

    body::after {
      content: "Michael Chuang · ADLINK PM";
      position: fixed;
      right: 18px;
      bottom: 14px;
      z-index: 1000;
      color: rgba(27, 31, 36, 0.28);
      font-size: 12px;
      font-weight: 800;
      pointer-events: none;
    }

    .container {
      max-width: 1220px;
      margin: 0 auto;
    }

    .header {
      background: #ffffff;
      color: #1b1f24;
      padding: 30px 34px;
      border-radius: 8px;
      margin-bottom: 22px;
      border: 1px solid #d9dee2;
      border-top: 6px solid #c8102e;
      box-shadow: 0 10px 26px rgba(27, 31, 36, 0.08);
    }

    .brandLine {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
      color: #5e6a75;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .brandMark {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 9px;
      border-left: 6px solid #c8102e;
      background: #f4f6f7;
      color: #1b1f24;
    }

    .header h1 {
      margin: 0 0 10px 0;
      font-size: 30px;
      line-height: 1.25;
      color: #1b1f24;
    }

    .header p {
      margin: 0;
      color: #5e6a75;
      font-size: 14px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 18px;
    }

    .summaryBox {
      background: #ffffff;
      padding: 18px 20px;
      border-radius: 8px;
      box-shadow: 0 8px 20px rgba(27, 31, 36, 0.07);
      border: 1px solid #d9dee2;
    }

    .summaryBox .label {
      font-size: 13px;
      color: #5e6a75;
      margin-bottom: 8px;
    }

    .summaryBox .value {
      font-size: 24px;
      font-weight: 800;
      color: #1b1f24;
    }

    .filters {
      background: #ffffff;
      border: 1px solid #d9dee2;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 18px;
      box-shadow: 0 8px 20px rgba(27, 31, 36, 0.07);
      display: grid;
      grid-template-columns: 1.1fr 1.6fr 2fr auto;
      gap: 12px;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    select,
    input {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 11px 12px;
      font-size: 14px;
      background: #ffffff;
    }

    .toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      cursor: pointer;
      font-weight: 700;
      background: #c8102e;
      color: white;
      white-space: nowrap;
    }

    button:hover {
      opacity: 0.9;
    }

    .summaryPanel {
      background: #ffffff;
      border: 1px solid #d9dee2;
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 18px;
      box-shadow: 0 8px 20px rgba(27, 31, 36, 0.07);
    }

    .summaryPanelTitle {
      font-weight: 900;
      color: #1b1f24;
      margin-bottom: 10px;
      font-size: 14px;
    }

    .pillWrap {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .categoryCount,
    .fileCount {
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
      font-weight: 800;
    }

    .categoryCount {
      background: #eef7f7;
      color: #006b6f;
      border: 1px solid #bfd9da;
    }

    .fileCount {
      background: #f4f6f7;
      color: #38424d;
      border: 1px solid #d9dee2;
    }

    .card {
      background: #ffffff;
      border-radius: 8px;
      padding: 22px 24px;
      margin-bottom: 18px;
      box-shadow: 0 8px 20px rgba(27, 31, 36, 0.07);
      border: 1px solid #d9dee2;
      border-left: 7px solid #c8102e;
    }

    .cardTop {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .badge {
      background: #fde8ed;
      color: #9f0c23;
      padding: 6px 11px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 800;
      white-space: nowrap;
    }

    .categoryPill {
      background: #eef7f7;
      color: #006b6f;
      padding: 6px 11px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 900;
      white-space: nowrap;
    }

    .project {
      font-size: 20px;
      font-weight: 800;
      color: #1b1f24;
      line-height: 1.4;
    }

    .issueTitle {
      font-size: 13px;
      font-weight: 800;
      color: #9f0c23;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .issue {
      background: #fff8f9;
      border: 1px solid #f4c4ce;
      border-radius: 8px;
      padding: 16px;
      line-height: 1.75;
      font-size: 15px;
      margin-bottom: 14px;
      white-space: normal;
      color: #1b1f24;
    }

    .metaGrid {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }

    .metaBox {
      background: #f8fafb;
      border: 1px solid #d9dee2;
      border-radius: 8px;
      padding: 12px 14px;
    }

    .metaLabel {
      font-size: 12px;
      color: #5e6a75;
      margin-bottom: 5px;
    }

    .metaValue {
      font-size: 14px;
      color: #1b1f24;
      font-weight: 700;
      word-break: break-word;
    }

    .source {
      color: #5e6a75;
      font-size: 13px;
      line-height: 1.5;
    }

    .empty {
      background: #ffffff;
      padding: 38px;
      border-radius: 8px;
      text-align: center;
      color: #5e6a75;
      border: 1px solid #d9dee2;
    }

    .footer {
      margin-top: 30px;
      color: #7a858f;
      font-size: 12px;
      text-align: center;
    }

    @media (max-width: 900px) {
      body {
        padding: 18px;
      }

      .summary,
      .metaGrid,
      .filters {
        grid-template-columns: 1fr;
      }

      .filters {
        position: static;
      }

      .header h1 {
        font-size: 24px;
      }

      .project {
        font-size: 18px;
      }

      .toolbar {
        justify-content: stretch;
      }

      button {
        width: 100%;
      }
    }

    @media print {
      body {
        background: white;
        padding: 0;
      }

      .filters,
      .toolbar {
        display: none;
      }

      .header,
      .summaryBox,
      .card,
      .summaryPanel {
        box-shadow: none;
      }

      .card {
        page-break-inside: avoid;
      }
    }
  </style>
</head>

<body>
  <main class="container">
    <header class="header">
      <div class="brandLine">
        <span class="brandMark">ADLINK</span>
        <span>SE Project Intelligence Report</span>
      </div>
      <h1>Red / Blue Font Report</h1>
      <p>ADLINK PM Agent 自動產生完整 HTML 報告｜產生時間：${escapeHtml(now)}</p>
    </header>

    <section class="summary">
      <div class="summaryBox">
        <div class="label">目前顯示數量</div>
        <div class="value" id="visibleCount">${items.length}</div>
      </div>

      <div class="summaryBox">
        <div class="label">全部 Critical 數量</div>
        <div class="value">${items.length}</div>
      </div>

      <div class="summaryBox">
        <div class="label">分類數量</div>
        <div class="value">${categories.length}</div>
      </div>

      <div class="summaryBox">
        <div class="label">Excel 檔案數</div>
        <div class="value">${files.length}</div>
      </div>
    </section>

    ${
      categories.length > 0
        ? `
          <section class="summaryPanel">
            <div class="summaryPanelTitle">分類統計</div>
            <div class="pillWrap">${categorySummaryHtml}</div>
          </section>
        `
        : ""
    }

    ${
      files.length > 0
        ? `
          <section class="summaryPanel">
            <div class="summaryPanelTitle">Excel 檔案統計</div>
            <div class="pillWrap">${fileSummaryHtml}</div>
          </section>
        `
        : ""
    }

    <section class="filters">
      <select id="categoryFilter">
        <option value="all">全部分類</option>
        ${generateCategoryOptions(categories)}
      </select>

      <select id="fileFilter">
        <option value="all">全部 Excel 檔案</option>
        ${generateFileOptions(files)}
      </select>

      <input id="searchInput" type="text" placeholder="搜尋 Project、Issue、Excel、Sheet、Row..." />

      <div class="toolbar">
        <button onclick="window.print()">列印 / 另存 PDF</button>
      </div>
    </section>

    <div id="cardsArea">
      ${
        items.length > 0
          ? cardsHtml
          : `<section class="empty">目前沒有找到 Critical Issues。</section>`
      }
    </div>

    <section id="emptyResult" class="empty" style="display:none;">
      目前篩選條件下沒有資料。
    </section>

    <div class="footer">
      Generated by ADLINK PM Agent
    </div>
  </main>

  <script>
    const categoryFilter = document.getElementById("categoryFilter");
    const fileFilter = document.getElementById("fileFilter");
    const searchInput = document.getElementById("searchInput");
    const visibleCount = document.getElementById("visibleCount");
    const emptyResult = document.getElementById("emptyResult");

    function normalize(text) {
      return String(text || "").toLowerCase().trim();
    }

    function applyFilters() {
      const selectedCategory = categoryFilter.value;
      const selectedFile = fileFilter.value;
      const keyword = normalize(searchInput.value);

      const cards = Array.from(document.querySelectorAll(".card"));

      let count = 0;

      cards.forEach((card) => {
        const category = card.dataset.category || "";
        const file = card.dataset.file || "";
        const searchText = normalize(card.dataset.search || "");

        const matchCategory =
          selectedCategory === "all" || category === selectedCategory;

        const matchFile =
          selectedFile === "all" || file === selectedFile;

        const matchKeyword =
          !keyword || searchText.includes(keyword);

        const visible = matchCategory && matchFile && matchKeyword;

        card.style.display = visible ? "" : "none";

        if (visible) {
          count += 1;
        }
      });

      visibleCount.textContent = count;
      emptyResult.style.display = count === 0 ? "" : "none";
    }

    categoryFilter.addEventListener("change", applyFilters);
    fileFilter.addEventListener("change", applyFilters);
    searchInput.addEventListener("input", applyFilters);

    applyFilters();
  </script>
</body>
</html>`;

  const htmlPath = getOutputHtmlPath(outputDir);
  fs.writeFileSync(htmlPath, html, "utf8");

  return htmlPath;
}

module.exports = { generateRedBlueFontHtml };
