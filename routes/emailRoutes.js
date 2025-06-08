const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { processCSVFile } = require('../utils/fileProcessor');
const { emailJobs, clients, processEmailJob } = require('../services/emailService');
const EmailAudit = require('../models/EmailAudit');
const UserProfile = require('../models/UserProfile');
const FollowUpTemplate = require('../models/FollowUpTemplate');
const { createTransporter } = require('../utils/emailUtils');
const { replaceTemplateVariables } = require('../utils/templateUtils');

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

// SSE endpoint for real-time progress updates
router.get('/send-emails-sse', (req, res) => {
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

// API endpoint to receive email data and start the process
router.post('/send-emails', upload.single('file'), async (req, res) => {
  try {
    console.log("Request ->", JSON.stringify(req.body, null, 2));

    const { email, password, mode, userType } = req.body;
    const customEmailBody = req.body.customEmailBody || null;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email credentials are required' });
    }

    // Check if user profile exists
    const userProfile = await UserProfile.findOne({ name: userType });
    if (!userProfile) {
      return res.status(404).json({ 
        success: false, 
        message: `No user profile found for: ${userType}` 
      });
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

// Send follow-up endpoint
router.post('/send-followup', async (req, res) => {
  try {
    const { recordId, userType, email, password } = req.body;
    
    const record = await EmailAudit.findById(recordId);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }

    // Prevent follow-ups on follow-up emails
    if (record.isFollowUp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot send follow-up to a follow-up email' 
      });
    }

    // Get user profile for display name
    const userProfile = await UserProfile.findOne({ name: userType });
    if (!userProfile) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    const template = userProfile.followUpTemplate;
    if (!template) {
      return res.status(404).json({ success: false, message: 'Follow-up template not found' });
    }

    const transporter = createTransporter(email, password);
    
    // Generate a new Message-ID for the follow-up that references the original
    const domain = email.split('@')[1];
    const newMessageId = `<followup.${Date.now()}.${record.jobId}@${domain}>`;

    const mailOptions = {
      from: `${userProfile.displayName} <${email}>`,
      to: record.email,
      subject: `Re: Request for an Interview Opportunity - ${record.role} at ${record.company}`,
      html: template.followUpTemplate,
      inReplyTo: record.messageId,
      references: record.threadId,
      messageId: newMessageId,
      headers: {
        'Message-ID': newMessageId,
        'In-Reply-To': record.messageId,
        'References': record.threadId,
        'X-Entity-Ref-ID': recordId,
        'X-Follow-Up': 'true',
        'Thread-Topic': `Interview Opportunity - ${record.role} at ${record.company}`,
        'Thread-Index': `${record.jobId}-${Date.now()}`,
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
      }
    };

    const info = await transporter.sendMail(mailOptions);

    // Create a new audit record for the follow-up
    const followUpRecord = new EmailAudit({
      jobId: `followup_${record.jobId}`,
      userProfile: userType,
      name: record.name,
      company: record.company,
      email: record.email,
      role: record.role,
      link: record.link,
      status: 'success',
      messageId: newMessageId,
      threadId: record.threadId,
      isFollowUp: true,
      originalMessageId: record.messageId,
      emailType: 'Follow-up Email'
    });

    await followUpRecord.save();

    // Update the original record's follow-up count and date
    record.followUpCount = (record.followUpCount || 0) + 1;
    record.lastFollowUpDate = new Date();
    await record.save();

    res.status(200).json({ 
      success: true, 
      message: 'Follow-up email sent successfully',
      info: info
    });

  } catch (error) {
    console.error('Error sending follow-up:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error sending follow-up' 
    });
  }
});

// Send bulk follow-up endpoint
router.post('/send-bulk-followup', async (req, res) => {
  try {
    const { email, password, userType, startDate, endDate } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email credentials are required' });
    }

    if (!userType) {
      return res.status(400).json({ success: false, message: 'User profile is required' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Date range is required' });
    }

    // Get user profile for display name
    const userProfile = await UserProfile.findOne({ name: userType });
    if (!userProfile) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    // Find eligible records
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Set to end of day

    const records = await EmailAudit.find({
      userProfile: userType,
      replyReceived: false,
      emailType: { $ne: 'Follow-up Email' },
      createdAt: { $gte: start, $lte: end },
      threadId: { $exists: true },
      messageId: { $exists: true }
    });

    if (!records || records.length === 0) {
      return res.status(400).json({ success: false, message: 'No eligible emails found for follow-up in the selected date range' });
    }

    console.log('Found eligible records:', records.length);

    // Create a unique job ID for this bulk follow-up
    const jobId = uuidv4();

    // Initialize job tracking
    emailJobs.set(email, {
      jobId,
      total: records.length,
      current: 0,
      success: 0,
      failed: 0,
      email,
      userType,
      data: records
    });

    // Send initial progress
    const client = clients.get(email);
    if (client) {
      client.write(`data: ${JSON.stringify({
        type: 'progress',
        total: records.length,
        current: 0,
        success: 0,
        failed: 0
      })}\n\n`);
    }

    // Create transporter first to validate credentials
    const transporter = createTransporter(email, password);
    
    // Log transporter creation
    console.log('Created transporter for:', {
      email,
      userType,
      recordCount: records.length
    });

    // Return success response immediately to start background processing
    res.status(200).json({ 
      success: true, 
      message: 'Started sending follow-up emails',
      jobId
    });

    // Process records in the background
    try {
      const template = await FollowUpTemplate.findOne({ userProfile: userType });
      if (!template) {
        if (client) {
          client.write(`data: ${JSON.stringify({
            type: 'log',
            message: `❌ No template found for user ${userType}`
          })}\n\n`);
        }
        return;
      }

      console.log('Starting bulk follow-up with template:', {
        userType,
        templateExists: !!template,
        recordCount: records.length
      });

      for (const record of records) {
        try {
          console.log('Processing record:', {
            email: record.email,
            company: record.company,
            role: record.role,
            threadId: record.threadId,
            messageId: record.messageId
          });
          // Generate a new Message-ID for the follow-up
          const domain = email.split('@')[1];
          const newMessageId = `<followup-bulk.${Date.now()}.${record.jobId}@${domain}>`;

          const mailOptions = {
            from: `${userProfile.displayName} <${email}>`,
            to: record.email,
            subject: `Re: Request for an Interview Opportunity - ${record.role} at ${record.company}`,
            html: template.followUpTemplate,
            inReplyTo: record.messageId,
            references: record.threadId,
            messageId: newMessageId,
            headers: {
              'Message-ID': newMessageId,
              'In-Reply-To': record.messageId,
              'References': record.threadId,
              'X-Entity-Ref-ID': record._id,
              'X-Follow-Up': 'true',
              'Thread-Topic': `Interview Opportunity - ${record.role} at ${record.company}`,
              'Thread-Index': `${record.jobId}-${Date.now()}`,
              'X-Priority': '1',
              'X-MSMail-Priority': 'High',
              'Importance': 'high'
            }
          };

          await transporter.sendMail(mailOptions);

          // Create a new audit record for the follow-up
          const followUpRecord = new EmailAudit({
            jobId: `followup_${record.jobId}`,
            userProfile: userType,
            name: record.name,
            company: record.company,
            email: record.email,
            role: record.role,
            link: record.link,
            status: "success",
            messageId: newMessageId,
            threadId: record.threadId,
            isFollowUp: true,
            originalMessageId: record.messageId,
            emailType: 'Follow-up Email'
          });

          await followUpRecord.save();

          // Update the original record's follow-up count and date
          await EmailAudit.findByIdAndUpdate(record._id, {
            $inc: { followUpCount: 1 },
            $set: { lastFollowUpDate: new Date() }
          });

          // Update job progress
          const job = emailJobs.get(email);
          if (job) {
            job.current++;
            job.success++;
            
            if (client) {
              // Send progress update first
              client.write(`data: ${JSON.stringify({
                type: 'progress',
                total: job.total,
                current: job.current,
                success: job.success,
                failed: job.failed
              })}\n\n`);
              
              // Then send success log
              client.write(`data: ${JSON.stringify({
                type: 'log',
                message: `${job.current}/${job.total}: Successfully sent follow-up email to ${record.email}`
              })}\n\n`);
            }
          }

        } catch (error) {
          console.error('Error sending follow-up:', {
            error: error.message,
            stack: error.stack,
            record: {
              email: record.email,
              company: record.company,
              role: record.role,
              threadId: record.threadId,
              messageId: record.messageId
            }
          });
          
          // Update job progress
          const job = emailJobs.get(email);
          if (job) {
            job.current++;
            job.failed++;
            
            if (client) {
              // Send error log first with more details
              client.write(`data: ${JSON.stringify({
                type: 'log',
                message: `${job.current}/${job.total}: Failed to send follow-up to ${record.email}: ${error.message} (${error.code || 'Unknown error'})`
              })}\n\n`);
              
              // Then send progress update
              client.write(`data: ${JSON.stringify({
                type: 'progress',
                total: job.total,
                current: job.current,
                success: job.success,
                failed: job.failed
              })}\n\n`);
            }
          }
        }
      }

      // Send completion event
      const job = emailJobs.get(email);
      if (job && client) {
        client.write(`data: ${JSON.stringify({
          type: 'complete',
          success: job.success,
          failed: job.failed
        })}\n\n`);
        emailJobs.delete(email);
      }

    } catch (error) {
      console.error('Error in bulk follow-up process:', error);
      if (client) {
        client.write(`data: ${JSON.stringify({
          type: 'log',
          message: `❌ Error in bulk follow-up process: ${error.message}`
        })}\n\n`);
      }
      const job = emailJobs.get(email);
      if (job && client) {
        client.write(`data: ${JSON.stringify({
          type: 'complete',
          success: job.success,
          failed: job.failed
        })}\n\n`);
        emailJobs.delete(email);
      }
    }

  } catch (error) {
    console.error('Error sending bulk follow-ups:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error sending bulk follow-ups' 
    });
  }
});

// Resend email
router.post('/resend-email', async (req, res) => {
  try {
    const { recordId, userType, email, password } = req.body;

    // Find the original email record
    const originalRecord = await EmailAudit.findById(recordId);
    if (!originalRecord) {
      return res.status(404).json({ success: false, message: 'Original email record not found' });
    }

    // Get user profile for display name
    const userProfile = await UserProfile.findOne({ name: userType.toLowerCase() });
    if (!userProfile) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    // Get the appropriate template based on email type
    let emailContent;
    if (originalRecord.customEmailBody) {
      emailContent = originalRecord.customEmailBody;
    } else if (originalRecord.emailType === 'Follow-up Email') {
      if (!userProfile.followUpTemplate) {
        return res.status(404).json({ success: false, message: 'Follow-up template not found' });
      }
      emailContent = userProfile.followUpTemplate;
    }else {
      if (!userProfile.emailTemplate) {
        return res.status(404).json({ success: false, message: 'Email template not found' });
      }
      emailContent = userProfile.emailTemplate;
    }

    // Replace template variables
    const data = {
      name: originalRecord.name,
      company: originalRecord.company,
      role: originalRecord.role,
      link: originalRecord.link
    };
    emailContent = replaceTemplateVariables(emailContent, data);

    // Create email transporter
    const transporter = createTransporter(email, password);

    // Send email
    const info = await transporter.sendMail({
      from: userProfile.displayName,
      to: originalRecord.email,
      subject: originalRecord.subject || `Interview Opportunity at ${originalRecord.company}`,
      text: emailContent,
      html: emailContent
    });

    // Create new audit record
    const newRecord = new EmailAudit({
      jobId: `resend_${originalRecord.jobId || uuidv4()}`,
      threadId: originalRecord.threadId || info.messageId,
      userProfile: userType.toLowerCase(),
      name: originalRecord.name,
      company: originalRecord.company,
      role: originalRecord.role,
      email: originalRecord.email,
      link: originalRecord.link,
      subject: originalRecord.subject || `Interview Opportunity at ${originalRecord.company}`,
      emailContent: emailContent,
      emailType: originalRecord.emailType,
      customEmailBody: originalRecord.customEmailBody,
      status: 'success',
      messageId: info.messageId
    });

    await newRecord.save();

    res.json({ success: true, message: 'Email resent successfully' });
  } catch (error) {
    console.error('Error in resend-email:', error);
    res.status(500).json({ success: false, message: error.message || 'Error resending email' });
  }
});

module.exports = router; 