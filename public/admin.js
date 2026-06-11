const userForm = document.getElementById("userForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const isAdminInput = document.getElementById("isAdmin");
const addUserButton = document.getElementById("addUserButton");
const statusEl = document.getElementById("adminStatus");
const suggestedUsersEl = document.getElementById("suggestedUsers");
const usersListEl = document.getElementById("usersList");

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

function renderSuggested(names, users) {
  const existing = new Set(users.map((user) => user.username.toLowerCase()));
  suggestedUsersEl.innerHTML = names
    .map((name) => {
      const exists = existing.has(name.toLowerCase());
      return `
        <button class="nameChip" type="button" data-name="${name}" ${exists ? "disabled" : ""}>
          ${name}${exists ? " 已存在" : ""}
        </button>
      `;
    })
    .join("");

  suggestedUsersEl.querySelectorAll("button[data-name]").forEach((button) => {
    button.addEventListener("click", () => {
      usernameInput.value = button.dataset.name;
      passwordInput.focus();
    });
  });
}

function renderUsers(users) {
  usersListEl.innerHTML = users
    .map((user) => {
      return `
        <article class="userRow">
          <div>
            <strong>${user.username}</strong>
            <span>${user.isAdmin ? "管理員" : "一般使用者"}</span>
          </div>
          <small>${user.status}</small>
        </article>
      `;
    })
    .join("");
}

async function loadUsers() {
  const response = await fetch("/api/users");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "讀取使用者失敗。");

  renderSuggested(payload.suggestedUsernames || [], payload.users || []);
  renderUsers(payload.users || []);
}

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  addUserButton.disabled = true;
  setStatus("正在新增使用者...", "working");

  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
        isAdmin: isAdminInput.checked,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "新增使用者失敗。");
    }

    userForm.reset();
    setStatus(`已新增：${payload.user.username}`, "ok");
    await loadUsers();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    addUserButton.disabled = false;
  }
});

loadUsers().catch((err) => setStatus(err.message, "error"));
