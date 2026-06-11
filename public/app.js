const form = document.getElementById("uploadForm");
const submitButton = document.getElementById("submitButton");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const currentUserEl = document.getElementById("currentUser");
const adminLink = document.getElementById("adminLink");

const maxBytes = 50 * 1024 * 1024;

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

function renderResults(data) {
  const reports = data.reports || [];
  resultsEl.innerHTML = reports
    .map((report) => {
      const label = report.type === "critical" ? "Critical Issues" : "紅藍字體";
      return `
        <article class="reportItem">
          <div>
            <h2>${label}</h2>
            <p>${report.count} 筆結果</p>
          </div>
          <a href="${report.url}" target="_blank" rel="noopener">開啟報告</a>
        </article>
      `;
    })
    .join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = document.getElementById("excel").files[0];
  if (!file) {
    setStatus("請選擇 Excel 檔案。", "error");
    return;
  }

  if (file.size > maxBytes) {
    setStatus("檔案超過 50 MB 限制。", "error");
    return;
  }

  const data = new FormData(form);
  submitButton.disabled = true;
  resultsEl.innerHTML = "";
  setStatus("正在上傳與分析，請稍候...", "working");

  try {
    const response = await fetch("/api/report", {
      method: "POST",
      body: data,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "產生報告失敗。");
    }

    setStatus(`完成。報告會保留 ${payload.expiresAfterDays} 天。`, "ok");
    renderResults(payload);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/me");
    if (!response.ok) return;

    const payload = await response.json();
    const user = payload.user;

    if (user) {
      currentUserEl.textContent = `已登入：${user.username}`;
      adminLink.hidden = !user.isAdmin;
    }
  } catch (err) {
    currentUserEl.textContent = "";
  }
}

loadCurrentUser();
