const msg = document.querySelector("#adminMessage");
const form = document.querySelector("#adminLogin");
const area = document.querySelector("#adminArea");
const summaryBox = document.querySelector("#summary");
const customersBox = document.querySelector("#customers");
const logoutBtn = document.querySelector("#adminLogout");

function say(message, bad = false) {
  msg.textContent = message;
  msg.className = "message " + (bad ? "error" : "success");
}

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

function makeCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value == null ? "" : String(value);
  return cell;
}

function showSummary(customers, serverSummary) {
  const summary = {
    total: customers.length,
    pending: customers.filter(c => c.status === "pending").length,
    approved: customers.filter(c => c.status === "approved").length,
    rejected: customers.filter(c => c.status === "rejected").length
  };

  if (serverSummary && typeof serverSummary === "object") {
    for (const key of ["total", "pending", "approved", "rejected"]) {
      if (
        serverSummary[key] !== undefined &&
        Number.isFinite(Number(serverSummary[key]))
      ) {
        summary[key] = Number(serverSummary[key]);
      }
    }
  }

  summaryBox.replaceChildren();

  for (const [key, label] of [
    ["total", "Total Customers"],
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["rejected", "Rejected"]
  ]) {
    const card = document.createElement("div");
    card.className = "stat";

    const number = document.createElement("b");
    number.textContent = summary[key];

    const caption = document.createElement("span");
    caption.textContent = label;

    card.append(number, caption);
    summaryBox.appendChild(card);
  }
}

async function refresh() {
  try {
    const data = await api("/api/admin/customers");

    if (!Array.isArray(data.customers)) {
      throw new Error(
        "Server response mein customers list nahi hai. server.js check karein."
      );
    }

    const customers = data.customers;
    showSummary(customers, data.summary);
    customersBox.replaceChildren();

    if (customers.length === 0) {
      const row = document.createElement("tr");
      const cell = makeCell("No customers found.");
      cell.colSpan = 6;
      row.appendChild(cell);
      customersBox.appendChild(row);
      return;
    }

    customers.forEach(customer => {
      const row = document.createElement("tr");

      row.append(
        makeCell(customer.id),
        makeCell(customer.name),
        makeCell(customer.username),
        makeCell(customer.status),
        makeCell(customer.credits ?? 0)
      );

      const actions = document.createElement("td");

      // Status selection
      const status = document.createElement("select");

      ["pending", "approved", "rejected", "disabled"].forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = value === customer.status;
        status.appendChild(option);
      });

      const saveStatus = document.createElement("button");
      saveStatus.type = "button";
      saveStatus.textContent = "Save Status";
      saveStatus.className = "small";

      saveStatus.addEventListener("click", async () => {
        saveStatus.disabled = true;

        try {
          await api(`/api/admin/customers/${encodeURIComponent(customer.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: status.value })
          });

          say("Customer status update ho gaya.");
          await refresh();
        } catch (error) {
          say(error.message, true);
        } finally {
          saveStatus.disabled = false;
        }
      });

      // Credits input
      const credits = document.createElement("input");
      credits.type = "number";
      credits.min = "0";
      credits.max = "100000000";
      credits.step = "1";
      credits.value = customer.credits ?? 0;
      credits.className = "credit-input";
      credits.setAttribute("aria-label", "Customer credits");

      const saveCredits = document.createElement("button");
      saveCredits.type = "button";
      saveCredits.textContent = "Save Credits";
      saveCredits.className = "small";

      saveCredits.addEventListener("click", async () => {
        const value = Number(credits.value);

        if (
          credits.value.trim() === "" ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > 100000000
        ) {
          say("Credits mein 0 se 100000000 tak poora number likhein.", true);
          return;
        }

        saveCredits.disabled = true;

        try {
          await api(
            `/api/admin/customers/${encodeURIComponent(customer.id)}/credits`,
            {
              method: "PATCH",
              body: JSON.stringify({ credits: value })
            }
          );

          say("Customer credits update ho gaye.");
          await refresh();
        } catch (error) {
          say(error.message, true);
        } finally {
          saveCredits.disabled = false;
        }
      });

      actions.append(
        status,
        saveStatus,
        document.createElement("br"),
        credits,
        saveCredits
      );

      row.appendChild(actions);
      customersBox.appendChild(row);
    });
  } catch (error) {
    say(error.message, true);
  }
}

// Admin login
form.addEventListener("submit", async event => {
  event.preventDefault();

  const loginButton = form.querySelector('button[type="submit"], button:not([type])');

  if (loginButton) loginButton.disabled = true;

  try {
    const credentials = Object.fromEntries(new FormData(form));

    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(credentials)
    });

    form.classList.add("hidden");
    area.classList.remove("hidden");
    say("Admin login successful.");

    await refresh();
  } catch (error) {
    say(error.message, true);
  } finally {
    if (loginButton) loginButton.disabled = false;
  }
});

// Admin logout
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    await api("/api/admin/logout", {
      method: "POST",
      body: JSON.stringify({})
    });

    location.reload();
  } catch (error) {
    say(error.message, true);
    logoutBtn.disabled = false;
  }
});
