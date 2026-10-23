'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

const message = $('#message');

function showMessage(text, bad = false) {
  if (!message) return;
  message.textContent = String(text || '');
  message.className = `message ${bad ? 'error' : 'success'}`;
}

function showView(view) {
  const loginForm = $('#loginForm');
  const registerForm = $('#registerForm');

  if (loginForm) loginForm.classList.toggle('hidden', view !== 'login');
  if (registerForm) registerForm.classList.toggle('hidden', view !== 'register');

  $$('.tab').forEach(button =>
    button.classList.toggle('active', button.dataset.view === view)
  );

  if (message) message.textContent = '';
}

$$('.tab').forEach(button =>
  button.addEventListener('click', () => showView(button.dataset.view))
);

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body && typeof options.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || data.message || `Request failed (${response.status})`
    );
  }

  return data;
}

const registerForm = $('#registerForm');

if (registerForm) {
  registerForm.addEventListener('submit', async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const button = $('button[type="submit"], button:not([type])', form);

    if (button) button.disabled = true;

    try {
      const values = Object.fromEntries(new FormData(form));
      const result = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify(values)
      });

      form.reset();
      showMessage(
        result.message || 'Account created. Please wait for admin approval.'
      );
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

const loginForm = $('#loginForm');

if (loginForm) {
  loginForm.addEventListener('submit', async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const button = $('button[type="submit"], button:not([type])', form);

    if (button) button.disabled = true;

    try {
      const values = Object.fromEntries(new FormData(form));

      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify(values)
      });

      form.reset();
      await loadMember(true);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

async function loadMember(showError = false) {
  try {
    const data = await api('/api/me');
    const customer = data.customer || data.user;

    if (!customer) {
      throw new Error('Customer information was not returned by the server.');
    }

    const name = $('#memberName');
    const status = $('#memberStatus');
    const credits = $('#memberCredits');

    if (name) {
      name.textContent =
        `Welcome, ${customer.name || customer.username || 'Member'}`;
    }

    if (status) status.textContent = customer.status || 'Approved';
    if (credits) credits.textContent = String(customer.credits ?? 0);

    const memberArea = $('#memberArea');
    if (memberArea) memberArea.classList.remove('hidden');

    if (loginForm) loginForm.classList.add('hidden');
    if (registerForm) registerForm.classList.add('hidden');

    const tabs = $('.tabs');
    if (tabs) tabs.classList.add('hidden');

    showMessage('You are logged in.');
    return true;
  } catch (error) {
    if (showError) {
      showMessage(`Login/session check failed: ${error.message}`, true);
    }
    return false;
  }
}

const logoutBtn = $('#logoutBtn');

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;

    try {
      await api('/api/logout', {
        method: 'POST',
        body: JSON.stringify({})
      });

      window.location.reload();
    } catch (error) {
      showMessage(error.message, true);
      logoutBtn.disabled = false;
    }
  });
}

/* TikTok services and order forms */
(() => {
  const serviceList = $('#tiktokServices');
  if (!serviceList) return;

  const services = {
    Followers: [
      { name: 'All Mix', quantity: 3000, price: 250, flag: '🌐' },
      { name: 'Pakistan', quantity: 1000, price: 100, flag: '🇵🇰' },
      { name: 'United States', quantity: 1000, price: 100, flag: '🇺🇸' },
      { name: 'United Kingdom', quantity: 1000, price: 100, flag: '🇬🇧' },
      { name: 'India', quantity: 1000, price: 100, flag: '🇮🇳' },
      { name: 'Canada', quantity: 1000, price: 100, flag: '🇨🇦' },
      { name: 'Australia', quantity: 1000, price: 100, flag: '🇦🇺' }
    ],
    Likes: [
      { name: 'Mix Likes', quantity: 1000, price: 150, flag: '🌐' },
      { name: 'All in One Likes', quantity: 1000, price: 50, flag: '🌐' }
    ],
    Views: [
      { name: 'Standard', quantity: 2000, price: 10, flag: '▶️' }
    ],
    'Add Favourite': [
      { name: 'Standard', quantity: 1000, price: 500, flag: '⭐' }
    ],
    Share: [
      { name: 'Standard', quantity: 1000, price: 500, flag: '🔗' }
    ],
    Comment: [
      { name: 'Standard', quantity: 1000, price: 500, flag: '💬' }
    ]
  };

  let selectedService = 'Followers';

  const picker = $('#tiktokPackageList');
  const selected = $('#ttSelected');

  function renderPackages() {
    if (!picker) return;

    picker.replaceChildren();

    services[selectedService].forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tt-country';
      button.textContent =
        `${item.flag} ${item.name} — ${item.quantity.toLocaleString()} — Rs. ${item.price}`;

      button.addEventListener('click', () => renderOrder(item));
      picker.append(button);
    });
  }

  function renderOrder(item) {
    if (!selected) return;

    selected.replaceChildren();
    selected.classList.remove('hidden');

    const heading = document.createElement('h3');
    heading.textContent = `${item.flag} TikTok ${selectedService}`;

    const details = document.createElement('p');
    details.textContent =
      `${item.name} | Quantity: ${item.quantity.toLocaleString()} | Price: Rs. ${item.price}`;

    const form = document.createElement('form');
    form.id = 'ttOrderForm';

    const label = document.createElement('label');
    label.htmlFor = 'ttProfileLink';
    label.textContent = 'TikTok Profile Link';

    const input = document.createElement('input');
    input.id = 'ttProfileLink';
    input.name = 'profileLink';
    input.type = 'url';
    input.autocomplete = 'url';
    input.placeholder = 'https://www.tiktok.com/@username';
    input.required = true;

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary';
    submit.textContent = 'Submit Request';

    const status = document.createElement('p');
    status.setAttribute('role', 'status');

    form.append(label, input, submit, status);
    selected.append(heading, details, form);

    form.addEventListener('submit', async event => {
      event.preventDefault();

      let url;

      try {
        url = new URL(input.value.trim());
      } catch {
        status.textContent = 'Please enter a valid TikTok profile link.';
        return;
      }

      if (
        url.protocol !== 'https:' ||
        !/(^|\.)tiktok\.com$/i.test(url.hostname) ||
        !/^\/@[\w.-]+\/?$/.test(url.pathname)
      ) {
        status.textContent =
          'Enter a valid TikTok profile URL, such as https://www.tiktok.com/@username.';
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Submitting...';
      status.textContent = '';

      try {
        const result = await api('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            platform: 'TikTok',
            service: selectedService,
            country: item.name,
            package: item.name,
            profileLink: url.href
          })
        });

        selected.replaceChildren();

        const success = document.createElement('div');
        success.className = 'tt-order-success';

        const title = document.createElement('h3');
        title.textContent = 'Request Submitted Successfully!';

        const text = document.createElement('p');
        text.textContent =
          result.message ||
          `Your request #${result.order?.id || ''} has been received.`;

        success.append(title, text);
        selected.append(success);
      } catch (error) {
        status.textContent = error.message;
        submit.disabled = false;
        submit.textContent = 'Submit Request';
      }
    });
  }

  $$('.tt-service-button').forEach(button => {
    button.addEventListener('click', () => {
      selectedService = button.dataset.service;

      $$('.tt-service-button').forEach(item => {
        item.classList.toggle('active', item === button);
      });

      renderPackages();
      if (selected) {
        selected.replaceChildren();
        selected.classList.add('hidden');
      }
    });
  });

  renderPackages();
})();

loadMember(false);
