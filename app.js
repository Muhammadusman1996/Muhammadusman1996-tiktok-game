(() => {
  "use strict";

  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginMessage = document.getElementById("loginMessage");
  const registerMessage = document.getElementById("registerMessage");

  function showView(view) {
    const registering = view === "register";
    loginForm.hidden = registering;
    registerForm.hidden = !registering;

    document.querySelectorAll("[data-view]").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      if (button.matches("button")) {
        button.setAttribute("aria-pressed", String(active));
      }
    });

    loginMessage.textContent = "";
    registerMessage.textContent = "";
  }

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  const password = document.getElementById("registerPassword");
  const confirmPassword = document.getElementById("confirmPassword");

  function checkPasswordMatch() {
    confirmPassword.setCustomValidity(
      confirmPassword.value && password.value !== confirmPassword.value
        ? "Passwords do not match."
        : ""
    );
  }
  password.addEventListener("input", checkPasswordMatch);
  confirmPassword.addEventListener("input", checkPasswordMatch);

  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    checkPasswordMatch();

    if (!registerForm.reportValidity()) return;

    registerMessage.textContent =
      "The form is valid, but account creation is not connected yet. Server-side registration and a database are required.";
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;

    loginMessage.textContent =
      "Login is not connected yet. A secure server-side login endpoint is required before accounts can be accessed.";
  });

  showView("login");
})();
