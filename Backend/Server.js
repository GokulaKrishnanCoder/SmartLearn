import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { GoogleGenerativeAI } from "@google/generative-ai";
import contactRoutes from "./routes/Contact.js";

// Load env variables
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: [
  "http://localhost:5173",
  "https://smart-learn-learning-platform-hlms.vercel.app",
  "https://smart-learn-learning-platform-hlms-7cqsafqz3.vercel.app",
  "https://smart-learn-learning-platform-hlms-i4n1okgvx.vercel.app",
  "https://smart-learn-learning-platform-hlms-behez7mes.vercel.app"
],
credentials: true
}));
app.use("/api/contact", contactRoutes);
// ----- MongoDB Connection -----
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1); // Stop server if DB fails
  });

// ----- User Schema -----
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true }, // storing email as username
  password: { type: String, required: true }
});

// Use 'users' collection
const User = mongoose.model('User', userSchema, 'users');

// ----- Gemini AI -----
let genAI, model;
let geminiAvailable = true;

if (process.env.GEMINI_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
    console.log('✅ Gemini AI initialized');
  } catch (err) {
    console.error('❌ Gemini AI initialization error:', err.message);
    geminiAvailable = false;
  }
} else {
  console.log('⚠️ Gemini API key not found, using fallback mode');
  geminiAvailable = false;
}

// ----- Routes -----
app.use("/api/contact", contactRoutes); // ✅ contact routes handled separately

// ----- Auth: Signup -----
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(409).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();

    res.status(201).json({ message: 'User registered' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ----- Auth: Login -----
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ----- Middleware: Token Verification -----
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// ----- Protected Route -----
app.get('/api/protected', verifyToken, (req, res) => {
  res.json({ message: `Hello ${req.user.username}, you are authorized!` });
});

// ----- Debug: List Models -----
app.get('/api/models', async (req, res) => {
  if (!geminiAvailable) {
    return res.status(501).json({ error: "Gemini AI not available" });
  }
  
  try {
    const models = await genAI.listModels();
    res.json(models);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- AI Chat Endpoint -----
app.post('/api/chat', async (req, res) => {
  if (!geminiAvailable) {
    return res.status(501).json({ error: "Gemini AI not available" });
  }
  
  const { messages } = req.body;
  try {
    const content = messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    const result = await model.generateContent({ contents: content });
    const response = await result.response.text();

    res.json({ message: { role: 'assistant', content: response } });
  } catch (err) {
    console.error("Gemini API error:", err.message || err);
    res.status(200).json({ 
      message: { 
        role: 'assistant', 
        content: "I'm currently unable to process your request. Please try again later." 
      } 
    });
  }
});

// ----- Start Server -----
const PORT = process.env.PORT || 5000;
app.get('/', (req, res) => {
  res.send('✅ Backend is running');
});
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
