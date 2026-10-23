'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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

  $$('.tab').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  if (message) message.textContent = '';
}

$$('.tab').forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

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

// Customer registration
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
        result.message ||
        'Account created. Please wait for admin approval.'
      );
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

// Customer login
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

// Load the logged-in customer
async function loadMember(showError = false) {
  try {
    const data = await api('/api/me');
    const customer = data.customer || data.user;

    if (!customer) {
      throw new Error(
        'Customer information was not returned by the server.'
      );
    }

    const name = $('#memberName');
    const status = $('#memberStatus');
    const credits = $('#memberCredits');

    if (name) {
      name.textContent =
        `Welcome, ${customer.name || customer.username || 'Member'}`;
    }

    if (status) {
      status.textContent = customer.status || 'Approved';
    }

    if (credits) {
      credits.textContent = String(customer.credits ?? 0);
    }

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
      showMessage(
        `Login/session check failed: ${error.message}`,
        true
      );
    }

    return false;
  }
}

// Customer logout
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

// TikTok country selector and order form
(() => {
  const toggle = $('#tiktokToggle');
  const list = $('#tiktokCountryList');
  const arrow = $('#ttArrow');
  const selected = $('#ttSelected');

  if (!toggle || !list || !arrow || !selected) return;

  toggle.setAttribute(
    'aria-expanded',
    String(!list.classList.contains('hidden'))
  );

  // One toggle handler only
  toggle.addEventListener('click', () => {
    const opening = list.classList.contains('hidden');

    list.classList.toggle('hidden', !opening);
    toggle.setAttribute('aria-expanded', String(opening));
    arrow.textContent = opening ? '⌃' : '⌄';
  });

  // One country handler per country button
  $$('.tt-country', list).forEach(button => {
    button.addEventListener('click', () => {
      const country = (button.dataset.country || '').trim();
      const flag = button.dataset.flag || '🌐';

      if (!country) return;

      const isMix = country.toLowerCase() === 'all mix';
      const quantity = isMix ? 3000 : 1000;
      const price = isMix ? 250 : 100;

      selected.replaceChildren();
      selected.classList.remove('hidden');

      const heading = document.createElement('h3');
      heading.textContent = `${flag} ${country} TikTok Followers`;

      const details = document.createElement('p');
      details.textContent =
        `Quantity: ${quantity.toLocaleString()} Followers | Price: Rs. ${price}`;

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
          status.textContent =
            'Please enter a valid TikTok profile link.';
          return;
        }

        const validTikTokUrl =
          url.protocol === 'https:' &&
          /(^|\.)tiktok\.com$/i.test(url.hostname) &&
          /^\/@[\w.-]+\/?$/.test(url.pathname);

        if (!validTikTokUrl) {
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
              service: 'Followers',
              country,
              profileLink: url.href,
              quantity,
              price
            })
          });

          selected.replaceChildren();

          const success = document.createElement('div');
          success.className = 'tt-order-success';

          const icon = document.createElement('div');
          icon.className = 'tt-success-icon';
          icon.textContent = '✓';

          const title = document.createElement('h3');
          title.textContent = 'Request Submitted Successfully!';

          const text = document.createElement('p');
          text.textContent =
            result.message ||
            `Your request #${result.order?.id || ''} has been received.`;

          success.append(icon, title, text);
          selected.append(success);
        } catch (error) {
          status.textContent = error.message;
          submit.disabled = false;
          submit.textContent = 'Submit Request';
        }
      });
    });
  });
})();

// Restore an existing login session when the page opens
loadMember(false);
