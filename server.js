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
