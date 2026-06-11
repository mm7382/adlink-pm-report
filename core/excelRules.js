/**
 * Excel 掃描關鍵字與規則配置
 */
module.exports = {
  // Critical Issues 掃描規則
  criticalIssues: {
    headerKeywords: ["critical"],
    subKeywords: ["open"],
    // 嚴格定義分類詞，支援 Linux BSP 這類含空白的分類
    categories: [
      "Linux BSP",
      "EMC", 
      "RF", 
      "Safety", 
      "ME", 
      "Thermal", 
      "SIE",
      "SE",
      "HW1", 
      "HW2", 
      "HW3", 
      "HW4", 
      "HW5", 
      "HW6", 
      "BIOS", 
      "FW",
      "FPGA"
    ],
    projectNameKeywords: ["project name", "project", "project:"],
    // 排除特定標題，避免誤判
    excludeKeywords: ["status", "owner", "remark", "phase"],
  },

  // 紅藍字體分析規則
  colorScanner: {
    // 目標欄位關鍵字
    targetColumns: [
      "key issue",
      "key issues",
      "highlight",
      "highlights",
      "escalation",
      "escalations",
    ],

    // 分類規則
    focusRules: [
      {
        tag: "ME / Mechanical / 機構",
        keywords: ["me", "mechanical", "機構", "結構"],
      },
      {
        tag: "SED / SE / SIE",
        keywords: ["sed", "se", "sie", "system", "系統整合", "bom"],
      },
      {
        tag: "Thermal / 散熱",
        keywords: ["thermal", "temperature", "風扇", "散熱", "溫度"],
      },
      {
        tag: "EMC / RF / Safety",
        keywords: ["emc", "emi", "esd", "rf", "safety", "安規", "認證"],
      },
    ],

    // 顏色定義 (ARGB 格式)
    colors: {
      red: [
        "FF0000", "C00000", "E06666", "CC0000", "B00000", "A61C00", "C65911",
      ],
      blue: [
        "0000FF", "0070C0", "0563C1", "1155CC", "1F4E79", "2F75B5", "00B0F0",
      ],
    },
  },
};
