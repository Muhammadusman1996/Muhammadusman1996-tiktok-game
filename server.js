const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.static(path.join(__dirname, "public")));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!process.env.SESSION_SECRET) {
  console.warn("WARNING: SESSION_SECRET is not set. Set it in Render Environment.");
}
if (!process.env.ADMIN_PASSWORD_HASH) {
  console.warn("WARNING: ADMIN_PASSWORD_HASH is not set. Set a bcrypt hash in Render Environment.");
}
if (!process.env.ADMIN_USERNAME) {
  console.warn("WARNING: ADMIN_USERNAME is not set. Set it in Render Environment.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ customers: [], nextId: 1 }, null, 2));
}
function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { customers: [], nextId: 1 }; }
}
function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function safeCustomer(c) {
  return { id: c.id, name: c.name, username: c.username, status: c.status, credits: c.credits, createdAt: c.createdAt };
}
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));
app.use(session({
  name: "tiktokgame.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.use(express.static(path.join(__dirname, "public")));

function requireCustomer(req, res, next) {
  if (!req.session.customerId) return res.status(401).json({ error: "Please log in first." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: "Admin login required." });
  next();
}
function cleanString(value, max = 60) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));

app.post("/api/register", authLimiter, async (req, res) => {
  const name = cleanString(req.body.name, 60);
  const username = cleanString(req.body.username, 30).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (name.length < 2 || !/^[a-z0-9_.-]{3,30}$/.test(username) || password.length < 8) {
    return res.status(400).json({ error: "Name, username (3–30 letters/numbers/._-), and password (at least 8 characters) are required." });
  }
  const db = readDb();
  if (db.customers.some(c => c.username === username)) return res.status(409).json({ error: "Username already exists." });
  const passwordHash = await bcrypt.hash(password, 12);
  const customer = {
    id: db.nextId++, name, username, passwordHash,
    status: "pending", credits: 0, createdAt: new Date().toISOString()
  };
  db.customers.push(customer);
  writeDb(db);
  res.status(201).json({ message: "Registration submitted. Wait for admin approval before logging in." });
});

app.post("/api/login", authLimiter, async (req, res) => {
  const username = cleanString(req.body.username, 30).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const db = readDb();
  const customer = db.customers.find(c => c.username === username);
  if (!customer || !(await bcrypt.compare(password, customer.passwordHash))) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  if (customer.status !== "approved") {
    return res.status(403).json({ error: customer.status === "rejected" ? "Your account was rejected. Contact admin." : "Your account is pending admin approval." });
  }
  req.session.customerId = customer.id;
  res.json({ message: "Login successful.", customer: safeCustomer(customer) });
});

app.get("/api/me", requireCustomer, (req, res) => {
  const db = readDb();
  const c = db.customers.find(x => x.id === req.session.customerId);
  if (!c || c.status !== "approved") {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Session expired or account not approved." });
  }
  res.json({ customer: safeCustomer(c) });
});
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Logged out." }));
});

app.post("/api/admin/login", authLimiter, async (req, res) => {
  const username = cleanString(req.body.username, 100);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const adminUsername = process.env.ADMIN_USERNAME || "";
  const hash = process.env.ADMIN_PASSWORD_HASH || "";
  if (!adminUsername || !hash || username !== adminUsername || !(await bcrypt.compare(password, hash))) {
    return res.status(401).json({ error: "Invalid admin username or password. Check Render Environment." });
  }
  req.session.isAdmin = true;
  res.json({ message: "Admin login successful." });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.isAdmin = false;
  res.json({ message: "Admin logged out." });
});
app.get("/api/admin/customers", requireAdmin, (_req, res) => {
  const db = readDb();
  res.json({
    summary: {
      total: db.customers.length,
      pending: db.customers.filter(c => c.status === "pending").length,
      approved: db.customers.filter(c => c.status === "approved").length,
      rejected: db.customers.filter(c => c.status === "rejected").length
    },
    customers: db.customers.map(safeCustomer)
  });
});
app.patch("/api/admin/customers/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = cleanString(req.body.status, 20);
  if (!Number.isInteger(id) || !["pending", "approved", "rejected", "disabled"].includes(status)) {
    return res.status(400).json({ error: "Invalid customer ID or status." });
  }
  const db = readDb();
  const customer = db.customers.find(c => c.id === id);
  if (!customer) return res.status(404).json({ error: "Customer not found." });
  customer.status = status;
  writeDb(db);
  res.json({ message: "Customer status updated." });
});
app.patch("/api/admin/customers/:id/credits", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const credits = Number(req.body.credits);
  if (!Number.isInteger(id) || !Number.isFinite(credits) || credits < 0 || credits > 100000000) {
    return res.status(400).json({ error: "Enter a valid non-negative credit amount." });
  }
  const db = readDb();
  const customer = db.customers.find(c => c.id === id);
  if (!customer) return res.status(404).json({ error: "Customer not found." });
  customer.credits = Math.floor(credits);
  writeDb(db);
  res.json({ message: "Credits updated." });
});

app.listen(PORT, "0.0.0.0", () => console.log(`TikTok Game Panel listening on ${PORT}`));
