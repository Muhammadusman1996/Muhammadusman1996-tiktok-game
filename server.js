const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MIN_PAYMENT_PKR = 2000;

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));

// Database
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({
      customers: [],
      nextId: 1,
      payments: [],
      nextPaymentId: 1
    }, null, 2)
  );
}

function readDb() {
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

  if (!Array.isArray(db.customers)) db.customers = [];
  if (!Array.isArray(db.payments)) db.payments = [];

  if (!Number.isInteger(db.nextId)) {
    db.nextId = db.customers.reduce(
      (max, c) => Math.max(max, Number(c.id) || 0), 0
    ) + 1;
  }

  if (!Number.isInteger(db.nextPaymentId)) {
    db.nextPaymentId = db.payments.reduce(
      (max, p) => Math.max(max, Number(p.id) || 0), 0
    ) + 1;
  }

  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanString(value, max = 60) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function safeCustomer(c) {
  return {
    id: c.id,
    name: c.name,
    username: c.username,
    status: c.status,
    credits: Number(c.credits || 0),
    balancePkr: Number(c.balancePkr || 0),
    createdAt: c.createdAt
  };
}

// Session configuration
if (!process.env.SESSION_SECRET ||
    !process.env.ADMIN_USERNAME ||
    !process.env.ADMIN_PASSWORD_HASH) {
  console.error(
    "Set SESSION_SECRET, ADMIN_USERNAME and ADMIN_PASSWORD_HASH in Render Environment."
  );
}

app.use(session({
  name: "royal.member.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

// Authentication middleware
function requireCustomer(req, res, next) {
  if (!req.session.customerId) {
    return res.status(401).json({
      error: "Please log in first."
    });
  }

  let db;

  try {
    db = readDb();
  } catch (error) {
    console.error("Database read error:", error.message);
    return res.status(500).json({ error: "Database unavailable." });
  }

  const customer = db.customers.find(
    c => String(c.id) === String(req.session.customerId)
  );

  if (!customer) {
    return res.status(401).json({
      error: "Customer account was not found. Please log in again."
    });
  }

  if (customer.status !== "approved") {
    return res.status(403).json({
      error: "Your account is not approved.",
      status: customer.status
    });
  }

  req.customer = customer;
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

// Pages and static files
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/app.js", (req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

app.get("/admin.js", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.js"));
});

// Prevent public access to the database directory.
app.use((req, res, next) => {
  if (/^\/data(?:\/|$)/i.test(req.path)) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(__dirname, {
  index: false,
  dotfiles: "deny"
}));

// Customer registration
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = cleanString(req.body.name, 80);
    const username = cleanString(req.body.username, 30).toLowerCase();
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (!name || !username || password.length < 6) {
      return res.status(400).json({
        error: "Name, username and password of at least 6 characters are required."
      });
    }

    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
      return res.status(400).json({
        error: "Username must contain 3–30 letters, numbers, dots, _ or -."
      });
    }

    const db = readDb();

    if (db.customers.some(c => c.username === username)) {
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
      success: true,
      message: "Account created. Please wait for admin approval."
    });
  } catch (error) {
    console.error("Registration error:", error.message);
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
      typeof req.body.password === "string" ? req.body.password : "";

    const db = readDb();
    const customer = db.customers.find(
      c => c.username === username
    );

    if (
      !customer ||
      !customer.passwordHash ||
      !await bcrypt.compare(password, customer.passwordHash)
    ) {
      return res.status(401).json({
        error: "Incorrect username or password."
      });
    }

    if (customer.status !== "approved") {
      return res.status(403).json({
        error: "Your account is not approved yet.",
        status: customer.status
      });
    }

    req.session.regenerate(err => {
      if (err) {
        console.error("Customer session error:", err.message);
        return res.status(500).json({
          error: "Login session could not be created."
        });
      }

      req.session.customerId = customer.id;

      req.session.save(saveError => {
        if (saveError) {
          console.error("Customer session save error:", saveError.message);
          return res.status(500).json({
            error: "Login session could not be saved."
          });
        }

        return res.json({
          success: true,
          message: "Login successful.",
          customer: safeCustomer(customer)
        });
      });
    });
  } catch (error) {
    console.error("Customer login error:", error.message);
    return res.status(500).json({
      error: "Login failed."
    });
  }
});

// Current customer
app.get("/api/me", requireCustomer, (req, res) => {
  res.json({
    success: true,
    customer: safeCustomer(req.customer)
  });
});

// Customer logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: "Logout failed." });
    }

    res.clearCookie("royal.member.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    res.json({ success: true, message: "Logged out." });
  });
});

// Admin login
app.post("/api/admin/login", authLimiter, async (req, res) => {
  try {
    const username = cleanString(req.body.username, 100);
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (
      !process.env.ADMIN_USERNAME ||
      !process.env.ADMIN_PASSWORD_HASH ||
      username !== process.env.ADMIN_USERNAME
    ) {
      return res.status(401).json({
        error: "Invalid admin credentials."
      });
    }

    const valid = await bcrypt.compare(
      password,
      process.env.ADMIN_PASSWORD_HASH
    );

    if (!valid) {
      return res.status(401).json({
        error: "Invalid admin credentials."
      });
    }

    req.session.regenerate(err => {
      if (err) {
        return res.status(500).json({
          error: "Admin login failed."
        });
      }

      req.session.isAdmin = true;

      req.session.save(saveError => {
        if (saveError) {
          return res.status(500).json({
            error: "Admin session could not be saved."
          });
        }

        res.json({
          success: true,
          message: "Admin login successful."
        });
      });
    });
  } catch (error) {
    console.error("Admin login error:", error.message);
    res.status(500).json({ error: "Admin login failed." });
  }
});

// Admin logout
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: "Logout failed." });
    }

    res.clearCookie("royal.member.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    res.json({ success: true, message: "Admin logged out." });
  });
});

// Admin dashboard
app.get("/api/admin/dashboard", requireAdmin, (req, res) => {
  const db = readDb();

  res.json({
    success: true,
    totalCustomers: db.customers.length,
    pendingCustomers: db.customers.filter(c => c.status === "pending").length,
    approvedCustomers: db.customers.filter(c => c.status === "approved").length,
    rejectedCustomers: db.customers.filter(c => c.status === "rejected").length,
    totalPayments: db.payments.length,
    pendingPayments: db.payments.filter(p => p.status === "pending").length
  });
});

// Admin customer list, including summary for admin.js
app.get("/api/admin/customers", requireAdmin, (req, res) => {
  const db = readDb();

  res.json({
    success: true,
    summary: {
      total: db.customers.length,
      pending: db.customers.filter(c => c.status === "pending").length,
      approved: db.customers.filter(c => c.status === "approved").length,
      rejected: db.customers.filter(c => c.status === "rejected").length
    },
    customers: db.customers.map(safeCustomer)
  });
});

// Shared handler for customer status updates.
// Supports both the old admin.js URL and the explicit /status URL.
function updateCustomerStatus(req, res) {
  const id = Number(req.params.id);
  const status = cleanString(req.body.status, 20);

  if (
    !Number.isSafeInteger(id) ||
    !["pending", "approved", "rejected", "disabled"].includes(status)
  ) {
    return res.status(400).json({
      error: "Invalid customer ID or status."
    });
  }

  const db = readDb();
  const customer = db.customers.find(c => Number(c.id) === id);

  if (!customer) {
    return res.status(404).json({
      error: "Customer not found."
    });
  }

  customer.status = status;
  writeDb(db);

  return res.json({
    success: true,
    message: "Customer status updated.",
    customer: safeCustomer(customer)
  });
}

app.patch(
  "/api/admin/customers/:id/status",
  requireAdmin,
  updateCustomerStatus
);

// Compatibility route for the older admin.js
app.patch(
  "/api/admin/customers/:id",
  requireAdmin,
  updateCustomerStatus
);

// Admin update credits
app.patch("/api/admin/customers/:id/credits", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const credits = Number(req.body.credits);

  if (
    !Number.isSafeInteger(id) ||
    !Number.isSafeInteger(credits) ||
    credits < 0 ||
    credits > 100000000
  ) {
    return res.status(400).json({
      error: "Enter a valid customer ID and credits."
    });
  }

  const db = readDb();
  const customer = db.customers.find(c => Number(c.id) === id);

  if (!customer) {
    return res.status(404).json({ error: "Customer not found." });
  }

  customer.credits = credits;
  writeDb(db);

  res.json({
    success: true,
    message: "Credits updated.",
    customer: safeCustomer(customer)
  });
});

// Admin update PKR balance
app.patch("/api/admin/customers/:id/balance", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const balancePkr = Number(req.body.balancePkr);

  if (
    !Number.isSafeInteger(id) ||
    !Number.isFinite(balancePkr) ||
    balancePkr < 0
  ) {
    return res.status(400).json({ error: "Enter a valid balance." });
  }

  const db = readDb();
  const customer = db.customers.find(c => Number(c.id) === id);

  if (!customer) {
    return res.status(404).json({ error: "Customer not found." });
  }

  customer.balancePkr = balancePkr;
  writeDb(db);

  res.json({
    success: true,
    message: "Balance updated.",
    customer: safeCustomer(customer)
  });
});

// Customer submit payment
app.post("/api/payments", requireCustomer, (req, res) => {
  const amount = Number(req.body.amount);
  const method = cleanString(req.body.method, 40);
  const reference = cleanString(req.body.reference, 100);

  if (!Number.isFinite(amount) || amount < MIN_PAYMENT_PKR) {
    return res.status(400).json({
      error: `Minimum payment is Rs. ${MIN_PAYMENT_PKR}.`
    });
  }

  if (amount > 10000000) {
    return res.status(400).json({ error: "Payment amount is too high." });
  }

  if (!method) {
    return res.status(400).json({ error: "Payment method is required." });
  }

  const db = readDb();

  const payment = {
    id: db.nextPaymentId++,
    customerId: req.customer.id,
    username: req.customer.username,
    amount,
    method,
    reference,
    status: "pending",
    createdAt: new Date().toISOString(),
    reviewedAt: null
  };

  db.payments.push(payment);
  writeDb(db);

  res.status(201).json({
    success: true,
    message: "Payment request submitted for admin review.",
    payment
  });
});

// Customer payment history
app.get("/api/payments", requireCustomer, (req, res) => {
  const db = readDb();

  const payments = db.payments.filter(
    p => String(p.customerId) === String(req.customer.id)
  );

  res.json({ success: true, payments });
});

// Admin payment list
app.get("/api/admin/payments", requireAdmin, (req, res) => {
  const db = readDb();

  res.json({
    success: true,
    payments: db.payments
  });
});

// Admin approve/reject payment
app.patch("/api/admin/payments/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = cleanString(req.body.status, 20);

  if (
    !Number.isSafeInteger(id) ||
    !["approved", "rejected"].includes(status)
  ) {
    return res.status(400).json({
      error: "Invalid payment ID or status."
    });
  }

  const db = readDb();
  const payment = db.payments.find(p => Number(p.id) === id);

  if (!payment) {
    return res.status(404).json({ error: "Payment not found." });
  }

  if (payment.status !== "pending") {
    return res.status(409).json({
      error: "This payment has already been reviewed."
    });
  }

  if (status === "approved") {
    const customer = db.customers.find(
      c => String(c.id) === String(payment.customerId)
    );

    if (!customer) {
      return res.status(404).json({
        error: "Customer for this payment was not found."
      });
    }

    customer.balancePkr =
      Number(customer.balancePkr || 0) + Number(payment.amount);
  }

  payment.status = status;
  payment.reviewedAt = new Date().toISOString();

  writeDb(db);

  res.json({
    success: true,
    message: `Payment ${status}.`,
    payment
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ success: true, status: "running" });
});

// Unknown API route
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// Error handler
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (res.headersSent) return next(error);

  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Royal Member server running on port ${PORT}`);
});
