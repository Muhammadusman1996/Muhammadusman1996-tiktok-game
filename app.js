const $ = (selector) => document.querySelector(selector);

const message = $("#message");

function showMessage(text, bad = false) {
  message.textContent = text;
  message.className = "message " + (bad ? "error" : "success");
}

function showView(view) {
  $("#loginForm").classList.toggle("hidden", view !== "login");
  $("#registerForm").classList.toggle("hidden", view !== "register");

  document.querySelectorAll(".tab").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  message.textContent = "";
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

// Customer registration
$("#registerForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"], button:not([type])');

  if (button) button.disabled = true;

  try {
    const values = Object.fromEntries(new FormData(form));

    const result = await api("/api/register", {
      method: "POST",
      body: JSON.stringify(values)
    });

    form.reset();
    showMessage(
      result.message || "Account created. Please wait for admin approval."
    );
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
});

// Customer login
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"], button:not([type])');

  if (button) button.disabled = true;

  try {
    const values = Object.fromEntries(new FormData(form));

    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(values)
    });

    form.reset();

    // Verify that the server session is working.
    await loadMember(true);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
});

// Load the logged-in customer
async function loadMember(showError = false) {
  try {
    const data = await api("/api/me");

    if (!data.customer) {
      throw new Error("Customer information was not returned by the server.");
    }

    $("#memberName").textContent = "Welcome, " + data.customer.name;
    $("#memberStatus").textContent = data.customer.status;
    $("#memberCredits").textContent = data.customer.credits ?? 0;

    $("#memberArea").classList.remove("hidden");
    $("#loginForm").classList.add("hidden");
    $("#registerForm").classList.add("hidden");

    const tabs = document.querySelector(".tabs");
    if (tabs) tabs.classList.add("hidden");

    showMessage("You are logged in.");
    return true;
  } catch (error) {
    if (showError) {
      showMessage(
        "Login/session check failed: " + error.message,
        true
      );
    }

    return false;
  }
}

// Customer logout
$("#logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", {
      method: "POST",
      body: JSON.stringify({})
    });

    location.reload();
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Check for an existing login session on page load
loadMember(false);
/* TikTok Followers Country Services */
(() => {
  const ttToggle = document.querySelector("#tiktokToggle");
  const ttList = document.querySelector("#tiktokCountryList");
  const ttArrow = document.querySelector("#ttArrow");
  const ttSelected = document.querySelector("#ttSelected");

  if (!ttToggle || !ttList || !ttArrow || !ttSelected) return;

  ttToggle.addEventListener("click", () => {
    const opening = ttList.classList.contains("hidden");
    ttList.classList.toggle("hidden", !opening);
    ttArrow.textContent = opening ? "⌃" : "⌄";
  });

  document.querySelectorAll(".tt-country").forEach(button => {
    button.addEventListener("click", () => {
      const country = button.dataset.country;
      const flag = button.dataset.flag;
      const mix = country === "All Mix";
      const quantity = mix ? 3000 : 1000;
      const price = mix ? 250 : 100;

      ttSelected.replaceChildren();

      const heading = document.createElement("h3");
      heading.textContent = `${flag} ${country}`;

      const service = document.createElement("p");
      service.textContent = "Service: TikTok Followers";

      const qty = document.createElement("p");
      qty.textContent = `Quantity: ${quantity.toLocaleString()} Followers`;

      const cost = document.createElement("p");
      cost.textContent = `Price: Rs. ${price}`;

      ttSelected.append(heading, service, qty, cost);
      ttSelected.classList.remove("hidden");
    });
  });
})();
