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
app.use(express.static(__dirname, { index: false }));

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
  try {
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
  } catch (error) {
    console.error("Database error:", error.message);
    return {
      customers: [],
      nextId: 1,
      payments: [],
      nextPaymentId: 1
    };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanString(value, max = 60) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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

if (!process.env.SESSION_SECRET) {
  console.error("ERROR: Render Environment میں SESSION_SECRET لگائیں۔");
}
if (!process.env.ADMIN_USERNAME) {
  console.error("ERROR: Render Environment میں ADMIN_USERNAME لگائیں۔");
}
if (!process.env.ADMIN_PASSWORD_HASH) {
  console.error("ERROR: Render Environment میں ADMIN_PASSWORD_HASH لگائیں۔");
}

app.use(session({
  name: "royal.member.sid",
  secret: process.env.SESSION_SECRET || "change-this-development-secret",
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

function requireCustomer(req, res, next) {
  if (!req.session.customerId) {
    return res.status(401).json({ error: "Please log in first." });
  }

  const db = readDb();
  const customer = db.customers.find(
    c => c.id === req.session.customerId
  );

  if (!customer || customer.status !== "approved") {
    req.session.destroy(() => {});
    return res.status(403).json({
      error: "Your account is not approved or is unavailable."
    });
  }

  req.customer = customer;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: "Admin login required." });
  }
  next();
}

// Website pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

// Customer registration
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = cleanString(req.body.name, 80);
    const username = cleanString(req.body.username, 30).toLowerCase();
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (!name || !username || password.length < 6) {
      return res.status(400).json({
        error: "Name, username, and password of at least 6 characters are required."
      });
    }

    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
      return res.status(400).json({
        error: "Username must be 3–30 characters: letters, numbers, dot, _ or -."
      });
    }

    const db = readDb();

    if (db.customers.some(c => c.username === username)) {
      return res.status(409).json({ error: "Username already exists." });
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
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Registration failed." });
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

    if (!customer || !await bcrypt.compare(password, customer.passwordHash)) {
      return res.status(401).json({
        error: "Incorrect username or password."
      });
    }

    if (customer.status !== "approved") {
      return res.status(403).json({
        error: "Your account is pending admin approval."
      });
    }

    req.session.regenerate(err => {
      if (err) {
        console.error("Session error:", err);
        return res.status(500).json({ error: "Login failed." });
      }

      req.session.customerId = customer.id;

      req.session.save(saveErr => {
        if (saveErr) {
          console.error("Session save error:", saveErr);
          return res.status(500).json({ error: "Login failed." });
        }

        return res.json({
          success: true,
          message: "Login successful.",
          customer: safeCustomer(customer)
        });
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed." });
  }
});
// Get logged-in customer
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

    res.clearCookie("royal.member.sid");
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
      return res.status(401).json({ error: "Invalid admin credentials." });
    }

    const valid = await bcrypt.compare(
      password,
      process.env.ADMIN_PASSWORD_HASH
    );

    if (!valid) {
      return res.status(401).json({ error: "Invalid admin credentials." });
    }

    req.session.regenerate(err => {
      if (err) {
        return res.status(500).json({ error: "Admin login failed." });
      }

      req.session.isAdmin = true;

      req.session.save(saveErr => {
        if (saveErr) {
          return res.status(500).json({ error: "Admin login failed." });
        }

        res.json({ success: true, message: "Admin login successful." });
      });
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Admin login failed." });
  }
});

// Admin logout
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: "Logout failed." });
    }

    res.clearCookie("royal.member.sid");
    res.json({ success: true, message: "Admin logged out." });
  });
});

// Admin dashboard summary
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

// Admin: list customers
app.get("/api/admin/customers", requireAdmin, (req, res) => {
  const db = readDb();

  res.json({
    success: true,
    customers: db.customers.map(safeCustomer)
  });
});

// Admin: approve/reject customer
app.patch("/api/admin/customers/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = cleanString(req.body.status, 20);

  if (!Number.isInteger(id) ||
      !["pending", "approved", "rejected", "disabled"].includes(status)) {
    return res.status(400).json({ error: "Invalid customer ID or status." });
  }

  const db = readDb();
  const customer = db.customers.find(c => c.id === id);

  if (!customer) {
    return res.status(404).json({ error: "Customer not found." });
  }

  customer.status = status;
  writeDb(db);

  res.json({
    success: true,
    message: "Customer status updated.",
    customer: safeCustomer(customer)
  });
});

// Admin: update customer credits
app.patch("/api/admin/customers/:id/credits", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const credits = Number(req.body.credits);

  if (!Number.isInteger(id) || !Number.isFinite(credits) || credits < 0) {
    return res.status(400).json({ error: "Enter a valid customer ID and credits." });
  }

  const db = readDb();
  const customer = db.customers.find(c => c.id === id);

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

// Admin: update customer PKR balance
app.patch("/api/admin/customers/:id/balance", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const balancePkr = Number(req.body.balancePkr);

  if (!Number.isInteger(id) || !Number.isFinite(balancePkr) || balancePkr < 0) {
    return res.status(400).json({ error: "Enter a valid balance." });
  }

  const db = readDb();
  const customer = db.customers.find(c => c.id === id);

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
