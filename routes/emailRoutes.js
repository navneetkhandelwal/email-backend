const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { processCSVFile } = require('../utils/fileProcessor');
const { emailJobs, clients, processEmailJob } = require('../services/emailService');

// Set up multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}_${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const filetypes = /csv|xlsx|xls/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only CSV, XLSX, and XLS files are allowed!'));
    }
  }
});

// API endpoint to receive email data and start the process
router.post('/send-emails', upload.single('file'), async (req, res) => {
  try {
    console.log("Request ->", JSON.stringify(req.body, null, 2));

    const { email, password, mode, userType } = req.body;
    const customEmailBody = req.body.customEmailBody || null;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email credentials are required' });
    }
    
    // Generate a unique ID for this job
    const jobId = uuidv4();
    
    let data = [];
    
    if (mode === 'csv') {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      data = processCSVFile(req.file.path);
    } else if (mode === 'manual') {
      if (!req.body.data) {
        return res.status(400).json({ success: false, message: 'No manual data provided' });
      }
      data = JSON.parse(req.body.data);
    }
    
    if (data.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid data found' });
    }
    
    // Store job data
    emailJobs.set(email, {
      jobId,
      data,
      email,
      password,
      userType,
      customEmailBody,
      status: 'preparing',
      total: data.length,
      current: 0,
      success: 0,
      failed: 0
    });
    
    // Start processing in the background
    setTimeout(() => {
      processEmailJob(email);
    }, 100);
    
    // Send immediate response
    res.status(200).json({ 
      success: true, 
      message: 'Email sending process started',
      jobId,
      total: data.length
    });
    
  } catch (error) {
    console.error('Error starting email sending process:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error processing request' 
    });
  }
});

// SSE endpoint for real-time progress updates
router.get('/send-emails-sse', (req, res) => {
  const email = req.query.email;

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

module.exports = router; 