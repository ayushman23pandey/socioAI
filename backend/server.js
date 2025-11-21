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
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

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
db.prepare(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    message TEXT,
    createdAt TEXT
  )
`).run();


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
app.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});
/**
 * POST /messages/send
 * Body: { receiver_id: number, message: string }
 * Auth: required (authenticate)
 */
app.post('/messages/send', authenticate, (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiver_id, message } = req.body;

    if (!receiver_id || !message || !message.trim()) {
      return res.status(400).json({ error: 'receiver_id and message are required' });
    }

    // Optional: check that receiver exists
    const receiver = db.prepare('SELECT id, email FROM users WHERE id = ?').get(receiver_id);
    if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

    const createdAt = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO messages (sender_id, receiver_id, message, createdAt)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(senderId, receiver_id, message, createdAt);

    const saved = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);

    res.status(201).json({ message: 'Sent', data: saved });
  } catch (err) {
    console.error('POST /messages/send', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /messages/chat?user=<id>
 * Returns messages between current user and the user id in query param
 * Auth: required
 */
app.get('/messages/chat', authenticate, (req, res) => {
  try {
    const me = req.user.id;
    const otherId = parseInt(req.query.user, 10);
    if (!otherId) return res.status(400).json({ error: 'Missing user query param' });

    // only allow if other user exists
    const other = db.prepare('SELECT id, email FROM users WHERE id = ?').get(otherId);
    if (!other) return res.status(404).json({ error: 'User not found' });

    const stmt = db.prepare(`
      SELECT * FROM messages
      WHERE (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
      ORDER BY createdAt ASC
    `);

    const rows = stmt.all(me, otherId, otherId, me);
    res.json({ conversationWith: other, messages: rows });
  } catch (err) {
    console.error('GET /messages/chat', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /messages/conversations
 * Returns a list of conversation peers with the last message
 * Auth: required
 */
app.get('/messages/conversations', authenticate, (req, res) => {
  try {
    const me = req.user.id;

    // This query collects peers and latest message between me and each peer
    // We select messages involving me, then group by peer and pick the latest createdAt
    const stmt = db.prepare(`
      SELECT peers.peer_id AS user_id,
             u.email,
             m.message,
             m.sender_id,
             m.receiver_id,
             m.createdAt
      FROM (
        SELECT
          CASE
            WHEN sender_id = ? THEN receiver_id
            ELSE sender_id
          END as peer_id,
          MAX(createdAt) AS lastAt
        FROM messages
        WHERE sender_id = ? OR receiver_id = ?
        GROUP BY peer_id
      ) AS peers
      LEFT JOIN messages m
        ON ( (m.sender_id = ? AND m.receiver_id = peers.peer_id OR m.sender_id = peers.peer_id AND m.receiver_id = ?) AND m.createdAt = peers.lastAt )
      LEFT JOIN users u ON u.id = peers.peer_id
      ORDER BY m.createdAt DESC
    `);

    const rows = stmt.all(me, me, me, me, me);
    res.json({ conversations: rows });
  } catch (err) {
    console.error('GET /messages/conversations', err);
    res.status(500).json({ error: 'Server error' });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
