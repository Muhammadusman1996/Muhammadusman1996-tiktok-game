const $ = (s) => document.querySelector(s);
const message = $("#message");
function showMessage(text, bad = false) { message.textContent = text; message.className = "message " + (bad ? "error" : "success"); }
function showView(view) {
  $("#loginForm").classList.toggle("hidden", view !== "login");
  $("#registerForm").classList.toggle("hidden", view !== "register");
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  message.textContent = "";
}
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
$("#registerForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  try {
    const result = await api("/api/register", { method: "POST", body: JSON.stringify(Object.fromEntries(f)) });
    e.currentTarget.reset(); showMessage(result.message);
  } catch (err) { showMessage(err.message, true); }
});
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(f)) });
    e.currentTarget.reset(); await loadMember();
  } catch (err) { showMessage(err.message, true); }
});
async function loadMember() {
  try {
    const data = await api("/api/me");
    $("#memberName").textContent = "Welcome, " + data.customer.name;
    $("#memberStatus").textContent = data.customer.status;
    $("#memberCredits").textContent = data.customer.credits;
    $("#memberArea").classList.remove("hidden");
    $("#loginForm").classList.add("hidden"); $("#registerForm").classList.add("hidden");
    document.querySelector(".tabs").classList.add("hidden");
    showMessage("You are logged in.");
  } catch {}
}
$("#logoutBtn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", body: "{}" }); } finally { location.reload(); }
});
loadMember();