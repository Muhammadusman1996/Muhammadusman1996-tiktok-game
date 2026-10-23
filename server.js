const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));
app.set("trust proxy", 1);

app.use(express.static(__dirname, { index: false }));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(
      {
        customers: [],
        nextId: 1,
        payments: [],
        nextPaymentId: 1,
        orders: [],
        nextOrderId: 1
      },
      null,
      2
    )
  );
}

function readDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    if (!Array.isArray(db.customers)) db.customers = [];
    if (!Array.isArray(db.payments)) db.payments = [];
    if (!Array.isArray(db.orders)) db.orders = [];

    if (!Number.isInteger(db.nextId)) {
      db.nextId =
        db.customers.reduce(
          (max, item) => Math.max(max, Number(item.id) || 0),
          0
        ) + 1;
    }

    if (!Number.isInteger(db.nextPaymentId)) {
      db.nextPaymentId =
        db.payments.reduce(
          (max, item) => Math.max(max, Number(item.id) || 0),
          0
        ) + 1;
    }

    if (!Number.isInteger(db.nextOrderId)) {
      db.nextOrderId =
        db.orders.reduce(
          (max, item) => Math.max(max, Number(item.id) || 0),
          0
        ) + 1;
    }

    return db;
  } catch (error) {
    console.error("Database read error:", error.message);
    return {
      customers: [],
      nextId: 1,
      payments: [],
      nextPaymentId: 1,
      orders: [],
      nextOrderId: 1
    };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function safeCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    username: customer.username,
    status: customer.status,
    credits: customer.credits,
    balancePkr: Number(customer.balancePkr || 0),
    createdAt: customer.createdAt
  };
}

function cleanString(value, max = 60) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

if (!process.env.SESSION_SECRET) {
  console.error("ERROR: Set SESSION_SECRET in Render Environment.");
}

if (!process.env.ADMIN_USERNAME) {
  console.error("ERROR: Set ADMIN_USERNAME in Render Environment.");
}

if (!process.env.ADMIN_PASSWORD_HASH) {
  console.error("ERROR: Set ADMIN_PASSWORD_HASH in Render Environment.");
}

app.use(
  session({
    name: "tiktokgame.sid",
    secret:
      process.env.SESSION_SECRET ||
      "development-only-change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

function requireCustomer(req, res, next) {
  if (!req.session.customerId) {
    return res.status(401).json({
      error: "Please log in first."
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({
      error: "Admin login required."
    });
  }

  next();
}

// TikTok service names, package names, quantities and prices.
const TIKTOK_SERVICES = {
  Followers: {
    Normal: {
      quantity: 1000,
      price: 100
    },
    "All Mix": {
      quantity: 3000,
      price: 250
    }
  },

  Likes: {
    "Mix Likes": {
      quantity: 1000,
      price: 150
    },
    "All in One Likes": {
      quantity: 1000,
      price: 50
    }
  },

  Views: {
    Standard: {
      quantity: 2000,
      price: 10
    }
  },

  "Add Favourite": {
    Standard: {
      quantity: 1000,
      price: 500
    }
  },

  Share: {
    Standard: {
      quantity: 1000,
      price: 500
    }
  },

  Comment: {
    Standard: {
      quantity: 1000,
      price: 500
    }
  }
};

// Pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

// Get available services and prices
app.get("/api/services", (req, res) => {
  return res.json({
    services: TIKTOK_SERVICES
  });
});

// Customer registration
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = cleanString(req.body.name, 60);
    const username = cleanString(req.body.username, 30).toLowerCase();
    const password =
      typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (
      name.length < 2 ||
      !/^[a-z0-9_.-]{3,30}$/.test(username) ||
      password.length < 8
    ) {
      return res.status(400).json({
        error:
          "Enter a name, username (3-30 letters/numbers/._-) and password (at least 8 characters)."
      });
    }

    const db = readDb();

    if (
      db.customers.some(
        customer => customer.username === username
      )
    ) {
      return res.status(409).json({
        error: "Username already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const customer = {
      id: db.nextId++,
      name,
      username,
      passwordHash,
      status: "pending",
      credits: 0,
      balancePkr: 0,
      createdAt: new Date().toISOString()
    };

    db.customers.push(customer);
    writeDb(db);

    return res.status(201).json({
      message: "Registration submitted. Wait for admin approval."
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      error: "Registration failed."
    });
  }
});

// Customer login
app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const username = cleanString(req.body.username, 30).toLowerCase();
    const password =
      typeof req.body.password === "string"
        ? req.body.password
        : "";

    const db = readDb();

    const customer = db.customers.find(
      item =>
        String(item.username || "").trim().toLowerCase() === username
    );

    if (!customer) {
      return res.status(401).json({
        error: "Username not found. Please register again."
      });
    }

    if (
      !customer.passwordHash ||
      !(await bcrypt.compare(password, customer.passwordHash))
    ) {
      return res.status(401).json({
        error: "Password does not match. Check your password."
      });
    }

    if (customer.status !== "approved") {
      return res.status(403).json({
        error:
          customer.status === "rejected"
            ? "Your account was rejected. Contact admin."
            : customer.status === "disabled"
              ? "Your account is disabled. Contact admin."
              : "Your account is pending admin approval."
      });
    }

    req.session.customerId = customer.id;

    return res.json({
      message: "Login successful.",
      customer: safeCustomer(customer)
    });
  } catch (error) {
    console.error("Customer login error:", error);
    return res.status(500).json({
      error: "Login failed."
    });
  }
});

// Current customer
app.get("/api/me", requireCustomer, (req, res) => {
  const db = readDb();

  const customer = db.customers.find(
    item => String(item.id) === String(req.session.customerId)
  );

  if (!customer || customer.status !== "approved") {
    return req.session.destroy(() => {
      res.status(401).json({
        error: "Session expired or account not approved."
      });
    });
  }

  return res.json({
    customer: safeCustomer(customer)
  });
});

// Customer logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        error: "Logout failed."
      });
    }

    return res.json({
      message: "Logged out."
    });
  });
});

// Admin login
app.post("/api/admin/login", authLimiter, async (req, res) => {
  try {
    const username = cleanString(req.body.username, 100);
    const password =
      typeof req.body.password === "string"
        ? req.body.password
        : "";

    const adminUsername = process.env.ADMIN_USERNAME || "";
    const hash = process.env.ADMIN_PASSWORD_HASH || "";

    if (
      !adminUsername ||
      !hash ||
      username !== adminUsername ||
      !(await bcrypt.compare(password, hash))
    ) {
      return res.status(401).json({
        error: "Invalid admin username or password. Check Render Environment."
      });
    }

    req.session.isAdmin = true;

    return res.json({
      message: "Admin login successful."
    });
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      error: "Admin login failed."
    });
  }
});

// Admin logout
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.isAdmin = false;

  return res.json({
    message: "Admin logged out."
  });
});

// Admin dashboard and customer list
app.get("/api/admin/customers", requireAdmin, (req, res) => {
  const db = readDb();

  return res.json({
    summary: {
      total: db.customers.length,
      pending: db.customers.filter(c => c.status === "pending").length,
      approved: db.customers.filter(c => c.status === "approved").length,
      rejected: db.customers.filter(c => c.status === "rejected").length,
      disabled: db.customers.filter(c => c.status === "disabled").length
    },

    customers: db.customers.map(safeCustomer)
  });
});

// Approve, reject, disable or re-enable customer
app.patch("/api/admin/customers/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = cleanString(req.body.status, 20);

  if (
    !Number.isInteger(id) ||
    !["pending", "approved", "rejected", "disabled"].includes(status)
  ) {
    return res.status(400).json({
      error: "Invalid customer ID or status."
    });
  }

  const db = readDb();
  const customer = db.customers.find(item => item.id === id);

  if (!customer) {
    return res.status(404).json({
      error: "Customer not found."
    });
  }

  customer.status = status;
  writeDb(db);

  return res.json({
    message: "Customer status updated."
  });
});

// Update customer credits
app.patch(
  "/api/admin/customers/:id/credits",
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);
    const credits = Number(req.body.credits);

    if (
      !Number.isInteger(id) ||
      !Number.isFinite(credits) ||
      credits < 0 ||
      credits > 100000000
    ) {
      return res.status(400).json({
        error: "Enter a valid non-negative credit amount."
      });
    }

    const db = readDb();
    const customer = db.customers.find(item => item.id === id);

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found."
      });
    }

    customer.credits = Math.floor(credits);
    writeDb(db);

    return res.json({
      message: "Credits updated."
    });
  }
);

// Customer TikTok orders: all six services
app.post("/api/orders", requireCustomer, (req, res) => {
  try {
    const platform = cleanString(req.body.platform, 20);
    const service = cleanString(req.body.service, 30);
    const packageName = cleanString(
      req.body.country || req.body.package,
      60
    );
    const profileLink = cleanString(req.body.profileLink, 300);

    if (platform !== "TikTok") {
      return res.status(400).json({
        error: "Invalid platform."
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(profileLink);
    } catch {
      return res.status(400).json({
        error: "Enter a valid TikTok profile link."
      });
    }

    if (
      parsedUrl.protocol !== "https:" ||
      !/(^|\.)tiktok\.com$/i.test(parsedUrl.hostname) ||
      !/^\/@[\w.-]+\/?$/.test(parsedUrl.pathname)
    ) {
      return res.status(400).json({
        error: "Enter a valid TikTok profile link."
      });
    }

    const servicePackages = TIKTOK_SERVICES[service];

    if (!servicePackages || !servicePackages[packageName]) {
      return res.status(400).json({
        error: "Select a valid service and package."
      });
    }

    const selected = servicePackages[packageName];
    const quantity = selected.quantity;
    const price = selected.price;

    const db = readDb();

    const customer = db.customers.find(
      item =>
        String(item.id) === String(req.session.customerId)
    );

    if (!customer || customer.status !== "approved") {
      return res.status(403).json({
        error: "Your account is not approved."
      });
    }

    const balance = Number(customer.balancePkr || 0);

    if (balance < price) {
      return res.status(400).json({
        error: "Insufficient balance. Please add funds first."
      });
    }

    customer.balancePkr = balance - price;

    const order = {
      id: db.nextOrderId++,
      customerId: customer.id,
      customerName: customer.name,
      username: customer.username,
      platform: "TikTok",
      service,
      country: packageName,
      packageName,
      profileLink: parsedUrl.href,
      quantity,
      pricePkr: price,
      status: "pending",
      createdAt: new Date().toISOString(),
      reviewedAt: null
    };

    db.orders.push(order);
    writeDb(db);

    return res.status(201).json({
      message: `TikTok ${service} order submitted successfully.`,
      order: {
        id: order.id,
        service: order.service,
        packageName: order.packageName,
        quantity: order.quantity,
        pricePkr: order.pricePkr,
        status: order.status
      }
    });
  } catch (error) {
    console.error("Order error:", error);

    return res.status(500).json({
      error: "Could not submit order."
    });
  }
});

// Minimum customer payment
const MIN_PAYMENT_PKR = 2000;

// Customer submits payment request
app.post("/api/payments", requireCustomer, (req, res) => {
  const amount = Number(req.body.amount);
  const transactionId = cleanString(req.body.transactionId, 100);

  if (
    !Number.isFinite(amount) ||
    amount < MIN_PAYMENT_PKR ||
    amount > 100000000 ||
    Math.round(amount * 100) !== amount * 100
  ) {
    return res.status(400).json({
      error: `Minimum payment is Rs. ${MIN_PAYMENT_PKR.toLocaleString("en-PK")}.`
    });
  }

  if (transactionId.length < 3) {
    return res.status(400).json({
      error: "Enter a valid Transaction ID."
    });
  }

  const db = readDb();

  const customer = db.customers.find(
    item =>
      String(item.id) === String(req.session.customerId)
  );

  if (!customer || customer.status !== "approved") {
    return res.status(403).json({
      error: "Your account is not approved."
    });
  }

  const duplicate = db.payments.some(
    payment =>
      String(payment.transactionId || "").toLowerCase() ===
      transactionId.toLowerCase()
  );

  if (duplicate) {
    return res.status(409).json({
      error: "This Transaction ID has already been submitted."
    });
  }

  const payment = {
    id: db.nextPaymentId++,
    customerId: customer.id,
    amountPkr: amount,
    transactionId,
    status: "pending",
    createdAt: new Date().toISOString(),
    reviewedAt: null
  };

  db.payments.push(payment);
  writeDb(db);

  return res.status(201).json({
    message: "Payment request submitted. Awaiting admin approval.",
    payment: {
      id: payment.id,
      amountPkr: payment.amountPkr,
      status: payment.status
    }
  });
});

// Customer payment history
app.get("/api/payments", requireCustomer, (req, res) => {
  const db = readDb();

  const payments = db.payments
    .filter(
      payment =>
        String(payment.customerId) ===
        String(req.session.customerId)
    )
    .map(payment => ({
      id: payment.id,
      amountPkr: payment.amountPkr,
      transactionId: payment.transactionId,
      status: payment.status,
      createdAt: payment.createdAt
    }));

  return res.json({ payments });
});

// Admin views payment requests
app.get("/api/admin/payments", requireAdmin, (req, res) => {
  const db = readDb();

  return res.json({
    payments: db.payments.map(payment => {
      const customer = db.customers.find(
        item =>
          String(item.id) === String(payment.customerId)
      );

      return {
        ...payment,
        customerName: customer?.name || "Unknown",
        username: customer?.username || "Unknown"
      };
    })
  });
});

// Admin approves or rejects payment
app.patch("/api/admin/payments/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const action = cleanString(req.body.status, 20);

  if (
    !Number.isInteger(id) ||
    !["approved", "rejected"].includes(action)
  ) {
    return res.status(400).json({
      error: "Invalid payment ID or status."
    });
  }

  const db = readDb();
  const payment = db.payments.find(item => item.id === id);

  if (!payment) {
    return res.status(404).json({
      error: "Payment not found."
    });
  }

  if (payment.status !== "pending") {
    return res.status(409).json({
      error: "This payment has already been reviewed."
    });
  }

  if (action === "approved") {
    const customer = db.customers.find(
      item =>
        String(item.id) === String(payment.customerId)
    );

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found."
      });
    }

    customer.balancePkr =
      Number(customer.balancePkr || 0) +
      Number(payment.amountPkr);
  }

  payment.status = action;
  payment.reviewedAt = new Date().toISOString();

  writeDb(db);

  return res.json({
    message:
      action === "approved"
        ? "Payment approved. Customer balance updated."
        : "Payment rejected."
  });
});

// Admin order list
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const db = readDb();

  return res.json({
    orders: db.orders.map(order => ({
      ...order,
      service: order.service || "Followers"
    }))
  });
});

// Health check
app.get("/health", (req, res) => {
  return res.json({
    status: "ok"
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`TikTok Game Panel listening on port ${PORT}`);
});
