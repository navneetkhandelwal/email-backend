// server.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const auth = require('./middleware/auth');
const connectDB = require('./config/database');
const emailRoutes = require('./routes/emailRoutes');
const templateRoutes = require('./routes/templateRoutes');
const auditRoutes = require('./routes/auditRoutes');
const userProfileRoutes = require('./routes/userProfileRoutes');
const { v4: uuidv4 } = require('uuid');
const EmailAudit = require('./models/EmailAudit');
const { emailJobs, clients, processEmailJob } = require('./services/emailService');

// Set JWT secrets
process.env.JWT_SECRET = 'your-super-secret-jwt-key-change-this-in-production';
process.env.JWT_REFRESH_SECRET = 'your-super-secret-refresh-token-key-change-this-in-production';

const app = express();
const port = process.env.PORT || 5001;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Unprotected routes first
app.use('/api/auth', require('./routes/authRoutes'));

// Extract the SSE route from emailRoutes
const sseRoute = express.Router();
sseRoute.get('/send-emails-sse', (req, res) => {
  const email = req.query.email;
  console.log('SSE connection request received for email:', email);

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Store the client's response object
  clients.set(email, res);
  console.log('Client stored for email:', email);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', status: 'connected' })}\n\n`);

  // Remove client when connection closes
  req.on('close', () => {
    console.log('Client disconnected:', email);
    clients.delete(email);
  });

  // Send a heartbeat every 30 seconds to keep the connection alive
  const heartbeat = setInterval(() => {
    if (clients.has(email)) {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
    } else {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Clean up on connection close
  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

// Register the SSE route before any auth middleware
app.use('/api', sseRoute);

// Protected routes after SSE route
app.use('/api/user-profiles', auth, userProfileRoutes);
app.use('/api', auth, templateRoutes);
app.use('/api', auth, emailRoutes);
app.use('/api', auth, auditRoutes);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
