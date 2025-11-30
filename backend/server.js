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
const { GoogleGenAI } = require("@google/genai");
require('dotenv').config();
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret';
const ACCESS_EXP = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const JWT_SECRET = "supersecretkeyhere123";

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

const app = express();
app.use(cookieParser());
app.use(cors());

const PORT = 5000;

app.use(express.json());
app.use("/feeds/uploads", express.static(path.join(__dirname, "feeds", "uploads")));
app.use("/reels/uploads", express.static(path.join(__dirname, "reels", "uploads")));

const db = new Database(path.join(__dirname, "database", "feeds.db"));

// Create tables
db.prepare(`
  CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    caption TEXT,
    text TEXT,
    filePath TEXT,
    createdAt TEXT,
    user_id INTEGER
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    createdAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    message TEXT,
    createdAt TEXT
  )
`).run();

// NEW: Reels table
db.prepare(`
  CREATE TABLE IF NOT EXISTS reels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    videoPath TEXT,
    caption TEXT,
    likes INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    createdAt TEXT
  )
`).run();

// Setup file storage for feeds
const feedStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "feeds/uploads");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const feedUpload = multer({ storage: feedStorage });

// Setup file storage for reels
const reelStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "reels/uploads";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const reelUpload = multer({ 
  storage: reelStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  }
});

// ===== FEEDS ENDPOINTS =====
app.post("/feeds", feedUpload.single("file"), (req, res) => {
  const { caption, text } = req.body;
  const file = req.file;

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

app.get("/feeds", (req, res) => {
  const stmt = db.prepare("SELECT * FROM feeds ORDER BY createdAt DESC");
  const feeds = stmt.all();
  res.json(feeds);
});

// ===== REELS ENDPOINTS =====

// Create a new reel
app.post("/reels", authenticate, reelUpload.single("video"), (req, res) => {
  try {
    const { caption } = req.body;
    const file = req.file;
    const userId = req.user.id;

    if (!file) {
      return res.status(400).json({ error: "Video file is required" });
    }

    const videoPath = `/reels/uploads/${file.filename}`;
    const createdAt = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO reels (user_id, videoPath, caption, createdAt)
      VALUES (?, ?, ?, ?)
    `);

    const info = stmt.run(userId, videoPath, caption || "", createdAt);

    res.status(201).json({
      message: "Reel created successfully!",
      reel: {
        id: info.lastInsertRowid,
        user_id: userId,
        videoPath,
        caption,
        likes: 0,
        views: 0,
        createdAt
      },
    });
  } catch (err) {
    console.error("Create reel error:", err);
    res.status(500).json({ error: "Failed to create reel" });
  }
});

// Get reels with pagination
app.get("/reels", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 10;
    const offset = page * limit;

    const stmt = db.prepare(`
      SELECT r.*, u.email as userEmail 
      FROM reels r
      LEFT JOIN users u ON r.user_id = u.id
      ORDER BY r.createdAt DESC
      LIMIT ? OFFSET ?
    `);

    const reels = stmt.all(limit, offset);
    
    // Get total count
    const countStmt = db.prepare("SELECT COUNT(*) as total FROM reels");
    const { total } = countStmt.get();

    res.json({
      reels,
      hasMore: offset + reels.length < total,
      total
    });
  } catch (err) {
    console.error("Get reels error:", err);
    res.status(500).json({ error: "Failed to fetch reels" });
  }
});

// Like a reel
app.post("/reels/:id/like", authenticate, (req, res) => {
  try {
    const reelId = req.params.id;
    
    const stmt = db.prepare(`
      UPDATE reels SET likes = likes + 1 WHERE id = ?
    `);
    
    stmt.run(reelId);
    
    const reel = db.prepare("SELECT * FROM reels WHERE id = ?").get(reelId);
    
    res.json({ likes: reel.likes });
  } catch (err) {
    console.error("Like reel error:", err);
    res.status(500).json({ error: "Failed to like reel" });
  }
});

// Increment view count
app.post("/reels/:id/view", (req, res) => {
  try {
    const reelId = req.params.id;
    
    const stmt = db.prepare(`
      UPDATE reels SET views = views + 1 WHERE id = ?
    `);
    
    stmt.run(reelId);
    
    res.json({ success: true });
  } catch (err) {
    console.error("View reel error:", err);
    res.status(500).json({ error: "Failed to record view" });
  }
});

// ===== AUTH ENDPOINTS =====
app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(400).json({ error: "Email already registered" });
  }

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

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "30d",
  });

  res.json({ message: "Login successful", token });
});

app.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ===== MESSAGES ENDPOINTS =====
app.post('/messages/send', authenticate, (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiver_id, message } = req.body;

    if (!receiver_id || !message || !message.trim()) {
      return res.status(400).json({ error: 'receiver_id and message are required' });
    }

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

app.get('/messages/chat', authenticate, (req, res) => {
  try {
    const me = req.user.id;
    const otherId = parseInt(req.query.user, 10);
    if (!otherId) return res.status(400).json({ error: 'Missing user query param' });

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

app.get('/messages/conversations', authenticate, (req, res) => {
  try {
    const me = req.user.id;

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
// Add this at the top with other requires
const axios = require('axios');

// Add this constant with other environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });


// ===== GEMINI AI ENDPOINT =====
// Add this endpoint before app.listen()
app.post("/gemini/chat", authenticate, async (req, res) => {
  try {
    const { message, conversationHistory, model = "gemini-2.5-flash" } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key not configured" });
    }

    // Build contents array
    const contents = [];

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        });
      });
    }

    // Add current message
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    // Generate content
    const response = await ai.models.generateContent({
      model: model,
      contents: contents
    });

    const aiResponse = response.text;

    res.json({
      success: true,
      response: aiResponse,
      model
    });

  } catch (err) {
    console.error("Gemini API error:", err);
    
    if (err.message?.includes("quota") || err.message?.includes("rate limit")) {
      return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
    }
    
    if (err.message?.includes("API key") || err.message?.includes("authentication")) {
      return res.status(500).json({ error: "Invalid API key or authentication failed" });
    }

    res.status(500).json({ 
      error: "Failed to get AI response",
      details: err.message
    });
  }
});

// Streaming endpoint (optional)
app.post("/gemini/chat/stream", authenticate, async (req, res) => {
  try {
    const { message, conversationHistory, model = "gemini-2.0-flash-exp" } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key not configured" });
    }

    // Build contents array
    const contents = [];

    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        });
      });
    }

    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Generate streaming content
    const stream = await ai.models.generateContentStream({
      model: model,
      contents: contents
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error("Gemini streaming error:", err);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Failed to stream AI response",
        details: err.message
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// List available models
app.get("/gemini/models", authenticate, async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key not configured" });
    }

    // Common Gemini 2.0 models
    const models = [
      {
        name: "gemini-2.0-flash-exp",
        displayName: "Gemini 2.0 Flash (Experimental)",
        description: "Fast and efficient model for most tasks"
      },
      {
        name: "gemini-1.5-pro",
        displayName: "Gemini 1.5 Pro",
        description: "Advanced model with extended context window"
      },
      {
        name: "gemini-1.5-flash",
        displayName: "Gemini 1.5 Flash",
        description: "Fast model for quick responses"
      }
    ];

    res.json({ models });

  } catch (err) {
    console.error("Gemini models error:", err);
    res.status(500).json({ error: "Failed to fetch models" });
  }
});
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});