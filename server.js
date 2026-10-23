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
app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));

// Serve website files
app.use(express.static(__dirname, { index: false }));

// --------------------------------------------------
// JSON DATABASE
// --------------------------------------------------

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
      nextPaymentId: 1,
      orders: [],
      nextOrderId: 1
    }, null, 2)
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
    throw new Error("Database read failed.");
  }
}

function writeDb(db) {
  const tempFile = DB_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

function cleanString(value, max = 60) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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

// --------------------------------------------------
// SESSION
// --------------------------------------------------

if (!process.env.SESSION_SECRET) {
  console.error("WARNING: Set SESSION_SECRET in Render Environment.");
}

if (!process.env.ADMIN_USERNAME) {
  console.error("WARNING: Set ADMIN_USERNAME in Render Environment.");
}

if (!process.env.ADMIN_PASSWORD_HASH) {
  console.error("WARNING: Set ADMIN_PASSWORD_HASH in Render Environment.");
}

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
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: "Admin login required." });
  }
  next();
}

// --------------------------------------------------
// WEBSITE PAGES
// --------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// --------------------------------------------------
// CUSTOMER REGISTRATION
// --------------------------------------------------

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = cleanString(req.body.name, 60);
    const username = cleanString(req.body.username, 30).toLowerCase();
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (
      name.length < 2 ||
      !/^[a-z0-9_.-]{3,30}$/.test(username) ||
      password.length < 8
    ) {
      return res.status(400).json({
        error: "Enter a valid name, username (3-30 characters), and password (at least 8 characters)."
      });
    }

    const db = readDb();

    const exists = db.customers.some(
      customer =>
        String(customer.username).toLowerCase() === username
    );

    if (exists) {
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
    console.error("Registration error:", error.message);
    return res.status(500).json({ error: "Registration failed." });
  }
});

// --------------------------------------------------
// CUSTOMER LOGIN
// --------------------------------------------------

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const username = cleanString(req.body.username, 30).toLowerCase();
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    const db = readDb();

    const customer = db.customers.find(
      item => String(item.username || "").toLowerCase() === username
    );

    if (
      !customer ||
      !customer.passwordHash ||
      !(await bcrypt.compare(password, customer.passwordHash))
    ) {
      return res.status(401).json({
        error: "Invalid username or password."
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

    req.session.regenerate(error => {
      if (error) {
        console.error("Session error:", error.message);
        return res.status(500).json({
          error: "Could not create login session."
        });
      }

      req.session.customerId = customer.id;

      req.session.save(saveError => {
        if (saveError) {
          console.error("Session save error:", saveError.message);
          return res.status(500).json({
            error: "Could not save login session."
          });
        }

        return res.json({
          message: "Login successful.",
          customer: safeCustomer(customer)
        });
      });
    });
  } catch (error) {
    console.error("Customer login error:", error.message);
    return res.status(500).json({ error: "Login failed." });
  }
});

// --------------------------------------------------
// CURRENT CUSTOMER SESSION
// --------------------------------------------------

app.get("/api/me", requireCustomer, (req, res) => {
  try {
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

    return res.json({ customer: safeCustomer(customer) });
  } catch (error) {
    console.error("Current customer error:", error.message);
    return res.status(500).json({
      error: "Could not load customer information."
    });
  }
});

// --------------------------------------------------
// CUSTOMER LOGOUT
// --------------------------------------------------

app.post("/api/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({ error: "Logout failed." });
    }

    res.clearCookie("tiktokgame.sid");

    return res.json({ message: "Logged out successfully." });
  });
});

// --------------------------------------------------
// ADMIN LOGIN
// --------------------------------------------------

app.post("/api/admin/login", authLimiter, async (req, res) => {
  try {
    const username = cleanString(req.body.username, 100);
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    const adminUsername = process.env.ADMIN_USERNAME || "";
    const hash = process.env.ADMIN_PASSWORD_HASH || "";

    if (
      !adminUsername ||
      !hash ||
      username !== adminUsername ||
      !(await bcrypt.compare(password, hash))
    ) {
      return res.status(401).json({
        error: "Invalid admin username or password."
      });
    }

    req.session.regenerate(error => {
      if (error) {
        return res.status(500).json({
          error: "Could not create admin session."
        });
      }

      req.session.isAdmin = true;

      req.session.save(saveError => {
        if (saveError) {
          return res.status(500).json({
            error: "Could not save admin session."
          });
        }

        return res.json({ message: "Admin login successful." });
      });
    });
  } catch (error) {
    console.error("Admin login error:", error.message);
    return res.status(500).json({ error: "Admin login failed." });
  }
});

// --------------------------------------------------
// ADMIN LOGOUT
// --------------------------------------------------

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({ error: "Admin logout failed." });
    }

    res.clearCookie("tiktokgame.sid");
    return res.json({ message: "Admin logged out." });
  });
});

// --------------------------------------------------
// ADMIN CUSTOMER LIST AND SUMMARY
// --------------------------------------------------

app.get("/api/admin/customers", requireAdmin, (req, res) => {
  try {
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
  } catch (error) {
    console.error("Admin customer list error:", error.message);
    return res.status(500).json({
      error: "Could not load customers."
    });
  }
});

// --------------------------------------------------
// ADMIN: CHANGE CUSTOMER STATUS
// --------------------------------------------------

app.patch("/api/admin/customers/:id", requireAdmin, (req, res) => {
  try {
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
    const customer = db.customers.find(item => Number(item.id) === id);

    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    customer.status = status;
    writeDb(db);

    return res.json({ message: "Customer status updated." });
  } catch (error) {
    console.error("Customer status error:", error.message);
    return res.status(500).json({
      error: "Could not update customer status."
    });
  }
});

// --------------------------------------------------
// ADMIN: UPDATE CUSTOMER CREDITS
// --------------------------------------------------

app.patch("/api/admin/customers/:id/credits", requireAdmin, (req, res) => {
  try {
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
    const customer = db.customers.find(item => Number(item.id) === id);

    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    customer.credits = Math.floor(credits);
    writeDb(db);

    return res.json({ message: "Credits updated." });
  } catch (error) {
    console.error("Credit update error:", error.message);
    return res.status(500).json({
      error: "Could not update credits."
    });
  }
});

// --------------------------------------------------
// TIKTOK FOLLOWERS ORDER SUBMISSION
// --------------------------------------------------

app.post("/api/orders", requireCustomer, (req, res) => {
  try {
    const platform = cleanString(req.body.platform, 30);
    const service = cleanString(req.body.service, 40);
    const country = cleanString(req.body.country, 50);
    const profileLink = cleanString(req.body.profileLink, 500);
    const quantity = Number(req.body.quantity);
    const price = Number(req.body.price);

    if (platform !== "TikTok" || service !== "Followers") {
      return res.status(400).json({
        error: "Unsupported platform or service."
      });
    }

    if (!country) {
      return res.status(400).json({
        error: "Please select a country."
      });
    }

    let profileUrl;

    try {
      profileUrl = new URL(profileLink);
    } catch {
      return res.status(400).json({
        error: "Enter a valid TikTok profile link."
      });
    }

    if (
      profileUrl.protocol !== "https:" ||
      !/(^|\.)tiktok\.com$/i.test(profileUrl.hostname) ||
      !/^\/@[\w.-]+\/?$/.test(profileUrl.pathname)
    ) {
      return res.status(400).json({
        error: "Enter a valid TikTok profile URL."
      });
    }

    // Confirm price and quantity on the server.
    const isMix = country.toLowerCase() === "all mix";
    const expectedQuantity = isMix ? 3000 : 1000;
    const expectedPrice = isMix ? 250 : 100;

    if (
      quantity !== expectedQuantity ||
      price !== expectedPrice
    ) {
      return res.status(400).json({
        error: "Quantity or price does not match the selected service."
      });
    }

    const db = readDb();

    const customer = db.customers.find(
      item => String(item.id) === String(req.session.customerId)
    );

    if (!customer || customer.status !== "approved") {
      return res.status(403).json({
        error: "Your account is not approved."
      });
    }

    if (!Array.isArray(db.orders)) db.orders = [];

    if (!Number.isInteger(db.nextOrderId)) {
      db.nextOrderId =
        db.orders.reduce(
          (max, order) => Math.max(max, Number(order.id) || 0),
          0
        ) + 1;
    }

    const order = {
      id: db.nextOrderId++,
      customerId: customer.id,
      customerName: customer.name,
      username: customer.username,
      platform: "TikTok",
      service: "Followers",
      country,
      profileLink: profileUrl.href,
      quantity: expectedQuantity,
      price: expectedPrice,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    db.orders.push(order);
    writeDb(db);

    return res.status(201).json({
      message: "Your TikTok followers request has been submitted and is awaiting review.",
      order: {
        id: order.id,
        platform: order.platform,
        service: order.service,
        country: order.country,
        quantity: order.quantity,
        price: order.price,
        status: order.status,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    console.error("TikTok order error:", error.message);
    return res.status(500).json({
      error: "Could not submit the order. Please try again."
    });
  }
});

// --------------------------------------------------
// CUSTOMER: VIEW OWN ORDERS
// --------------------------------------------------

app.get("/api/orders", requireCustomer, (req, res) => {
  try {
    const db = readDb();

    const orders = db.orders
      .filter(
        order => String(order.customerId) === String(req.session.customerId)
      )
      .map(order => ({
        id: order.id,
        platform: order.platform,
        service: order.service,
        country: order.country,
        profileLink: order.profileLink,
        quantity: order.quantity,
        price: order.price,
        status: order.status,
        createdAt: order.createdAt
      }));

    return res.json({ orders });
  } catch (error) {
    console.error("Customer order list error:", error.message);
    return res.status(500).json({
      error: "Could not load your orders."
    });
  }
});

// --------------------------------------------------
// ADMIN: VIEW ALL ORDERS
// --------------------------------------------------

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  try {
    const db = readDb();
    return res.json({ orders: db.orders });
  } catch (error) {
    console.error("Admin order list error:", error.message);
    return res.status(500).json({
      error: "Could not load orders."
    });
  }
});

// --------------------------------------------------
// ADMIN: UPDATE ORDER STATUS
// --------------------------------------------------

app.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = cleanString(req.body.status, 20);

    if (
      !Number.isInteger(id) ||
      !["pending", "processing", "completed", "rejected"].includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid order ID or status."
      });
    }

    const db = readDb();
    const order = db.orders.find(item => Number(item.id) === id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    order.status = status;
    order.updatedAt = new Date().toISOString();

    writeDb(db);

    return res.json({
      message: "Order status updated.",
      order
    });
  } catch (error) {
    console.error("Order status error:", error.message);
    return res.status(500).json({
      error: "Could not update order status."
    });
  }
});

// --------------------------------------------------
// PAYMENTS
// --------------------------------------------------

const MIN_PAYMENT_PKR = 2000;

// Customer submits a payment request
app.post("/api/payments", requireCustomer, (req, res) => {
  try {
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
      item => String(item.id) === String(req
