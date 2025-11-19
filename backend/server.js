const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path"); 
const Database = require("better-sqlite3");
const cors = require("cors");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret';
const ACCESS_EXP = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const JWT_SECRET = "supersecretkeyhere123"; // ⚠️ replace with something long & random

function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXP });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXP });
}

const app = express();
app.use(cookieParser()); // enable cookies
// Allow requests from your frontend
app.use(cors());


const PORT = 5000;

// Middleware to parse JSON bodies
app.use(express.json());
app.use("/feeds/uploads", express.static(path.join(__dirname, "feeds", "uploads")));

const db = new Database(path.join(__dirname, "database", "feeds.db"));

db.prepare(`
  CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    caption TEXT,
    text TEXT,
    filePath TEXT,
    createdAt TEXT
  )
`).run();

// after db is defined (better-sqlite3)
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    createdAt TEXT
  )
`).run();
try {
  db.prepare("ALTER TABLE feeds ADD COLUMN user_id INTEGER").run();
} catch (err) {
  if (!/duplicate column name/i.test(err.message)) {
    throw err;
  }
}


// Setup file storage for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "feeds/uploads");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });



// ✅ POST /feed - create a new feed

app.post("/feeds", upload.single("file"), (req, res) => {
  const { caption, text } = req.body;
  const file = req.file;

  // Validation
  if (!file && !text) {
    return res.status(400).json({
      error: "Feed must contain either a file/video (with caption) or text.",
    });
  }

  if (file && !caption) {
    return res.status(400).json({
      error: "A caption is required when uploading a file or video.",
    });
  }

  const type = file ? "media" : "text";
  const filePath = file ? `/feeds/uploads/${file.filename}` : null;
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO feeds (type, caption, text, filePath, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `);

  const info = stmt.run(type, caption || null, text || null, filePath, createdAt);

  res.status(201).json({
    message: "Feed created successfully!",
    feed: { id: info.lastInsertRowid, type, caption, text, filePath, createdAt },
  });
});
// ✅ (optional) GET /feeds - view all feeds
app.get("/feeds", (req, res) => {
  const stmt = db.prepare("SELECT * FROM feeds ORDER BY createdAt DESC");
  const feeds = stmt.all();
  res.json(feeds);
});
app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  // check if user exists
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(400).json({ error: "Email already registered" });
  }

  // hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  const stmt = db.prepare(`
    INSERT INTO users (email, password, createdAt)
    VALUES (?, ?, ?)
  `);
  const info = stmt.run(email, hashedPassword, new Date().toISOString());

  res.json({ message: "User registered successfully", userId: info.lastInsertRowid });
});
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // ✅ Create long-lived JWT (e.g., 30 days)
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "30d", // long lived token
  });

  res.json({ message: "Login successful", token });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
