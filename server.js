const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'database.json');

// Initialize database if it doesn't exist
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ 
    quizzes: [], 
    attempts: [], 
    users: [] 
  }, null, 2));
}

function readDB() {
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!data.users) data.users = [];
  return data;
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Ensure the initial seeded quizzes from app.js are in the backend if empty
function initializeWithSeeds() {
  const db = readDB();
  if (db.quizzes.length === 0) {
    db.quizzes = [
      {
        id: "q_demo_js", 
        authorId: "system", 
        authorName: "Quizora Team",
        title: "JavaScript Fundamentals", 
        description: "Test your JS knowledge",
        category: "Tech", 
        difficulty: "medium", 
        playCount: 156, 
        visibility: "public",
        createdAt: Date.now(), 
        updatedAt: Date.now(),
        questions: [{ id: "q1", text: "Which keyword defines a constant in JS?", options: ["var", "let", "const", "def"], correct: 2, explanation: "const defines block-scoped variables that cannot be reassigned." }]
      }
    ];
    writeDB(db);
  }
}
initializeWithSeeds();

// ── AUTH ENDPOINTS ──────────────────────────────────────────

app.post('/api/signup', (req, res) => {
  const db = readDB();
  const { name, email, password, avatar } = req.body;

  if (db.users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const newUser = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name,
    email,
    password, // In a real app, hash this!
    avatar: avatar || '🧠',
    xp: 0,
    quizzesTaken: 0,
    createdAt: Date.now()
  };

  db.users.push(newUser);
  writeDB(db);

  // Return user without password
  const { password: _, ...userSession } = newUser;
  res.status(201).json(userSession);
});

app.post('/api/login', (req, res) => {
  const db = readDB();
  const { email, password } = req.body;

  const user = db.users.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const { password: _, ...userSession } = user;
  res.json(userSession);
});

app.put('/api/users/:id', (req, res) => {
  const db = readDB();
  const index = db.users.findIndex(u => u.id === req.params.id);

  if (index >= 0) {
    db.users[index] = { ...db.users[index], ...req.body };
    writeDB(db);
    const { password: _, ...userSession } = db.users[index];
    res.json(userSession);
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// ── QUIZ ENDPOINTS ───────────────────────────────────────────

app.get('/api/quizzes', (req, res) => {
  const db = readDB();
  // Simply return all for now, frontend will handle visibility filtering
  res.json(db.quizzes);
});

app.post('/api/quizzes', (req, res) => {
  const db = readDB();
  const newQuiz = req.body;
  
  if (!newQuiz.id) newQuiz.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  newQuiz.createdAt = newQuiz.createdAt || Date.now();
  newQuiz.updatedAt = Date.now();
  newQuiz.visibility = newQuiz.visibility || 'public';
  
  db.quizzes.unshift(newQuiz);
  writeDB(db);
  
  res.status(201).json(newQuiz);
});

app.put('/api/quizzes/:id', (req, res) => {
  const db = readDB();
  const index = db.quizzes.findIndex(q => q.id === req.params.id);
  
  if (index >= 0) {
    db.quizzes[index] = { ...db.quizzes[index], ...req.body, updatedAt: Date.now() };
    writeDB(db);
    res.json(db.quizzes[index]);
  } else {
    res.status(404).json({ error: 'Quiz not found' });
  }
});

app.delete('/api/quizzes/:id', (req, res) => {
  const db = readDB();
  db.quizzes = db.quizzes.filter(q => q.id !== req.params.id);
  writeDB(db);
  res.status(204).send();
});

// ── ATTEMPT ENDPOINTS ────────────────────────────────────────

app.get('/api/attempts', (req, res) => {
  const db = readDB();
  res.json(db.attempts);
});

app.post('/api/attempts', (req, res) => {
  const db = readDB();
  const attempt = req.body;
  if (!attempt.id) attempt.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  attempt.timestamp = attempt.timestamp || Date.now();
  
  db.attempts.unshift(attempt);
  writeDB(db);
  
  res.status(201).json(attempt);
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
