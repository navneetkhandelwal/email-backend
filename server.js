// server.js
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://emailAdmin:emailPassword@cluster0.9ar1b.mongodb.net/email_script_db?retryWrites=true&w=majority&appName=Cluster0';

  mongoose.connect(MONGODB_URI)
  .then(() => console.log("Connected to DB:", mongoose.connection.name)) // Check database name
  .catch((err) => console.error("DB Connection Error:", err));

// Define MongoDB schemas and models
const userProfile = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
});

const userTemplate = new mongoose.Schema({
  userProfile: { type: String, required: true },
  userTemplate: { type: String, required: true }
});

const followUpTemplate = new mongoose.Schema({
  userProfile: { type: String, required: true },
  followUpTemplate: { type: String, required: true },
  lastUpdated: { type: Date, default: Date.now }
});

const emailAuditSchema = new mongoose.Schema({
  jobId: { type: String, required: true },
  userProfile: { type: String, required: true },
  name: { type: String, required: true },
  company: { type: String, required: true },
  email: { type: String, required: true },
  role: { type: String, required: true },
  link: { type: String, required: false },
  status: { type: String, required: true },
  errorDetails: { type: String, required: false },
  replyReceived: { type: Boolean, default: false },
  lastFollowUpDate: { type: Date },
  followUpCount: { type: Number, default: 0 },
  messageId: { type: String, required: true },
  threadId: { type: String, required: true },
  isFollowUp: { type: Boolean, default: false },
  originalMessageId: { type: String },
  emailType: { type: String, required: true }
}, { timestamps: true }); // Adds createdAt and updatedAt fields automatically

const UserProfile = mongoose.model('user_profiles', userProfile);
const EmailAudit = mongoose.model('email_audits', emailAuditSchema);
const UserTemplate = mongoose.model('user_templates', userTemplate);
const FollowUpTemplate = mongoose.model('followup_templates', followUpTemplate);

const app = express();
const port = process.env.PORT || 5001;

// Name mapping for email senders
const nameMap = {
  'navneet': 'Navneet Khandelwal',
  'teghdeep': 'Teghdeep Singh',
  'divyam': 'Divyam Bhardwaj',
  'dhananjay': 'Dhananjay Chauhan',
  'akash': 'Akash Sharma',
  'avi': 'Avi Arora',
  'komal': 'Komal Sharma',
  'pooja': 'Pooja Verma',
  'other': 'Interview Opportunity'
};

// Middleware
app.use(cors());
app.use(express.json());
// app.use(express.static(path.join(__dirname, '../client/build')));

// Set up multer for file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, {recursive: true});
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

// Store active SSE connections
const clients = new Map();

// Email sending queue and process management
const emailJobs = new Map();

// Add this helper function for email transport
function createTransporter(email, password) {
  console.log('Creating email transporter with:', {
    email,
    usingAppPassword: password.length === 16 // App passwords are 16 characters
  });

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: email,
        pass: password // This should be an App Password
      },
      debug: true, // Enable debug logs
      logger: true  // Enable built-in logger
    });

    // Verify the connection configuration
    transporter.verify(function(error, success) {
      if (error) {
        console.error('Transporter verification failed:', {
          error: error.message,
          code: error.code,
          response: error.response,
          stack: error.stack
        });
      } else {
        console.log('Server is ready to take our messages');
      }
    });

    return transporter;
  } catch (error) {
    console.error('Error creating transporter:', {
      error: error.message,
      code: error.code,
      response: error.response,
      stack: error.stack
    });
    throw error;
  }
}

// Handle CSV file processing
const processCSVFile = (filePath) => {
    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);
        return data;
    } catch (error) {
        console.error('Error processing CSV file:', error);
        throw new Error('Failed to process CSV file');
    }
};

// API endpoint to receive email data and start the process
app.post('/api/send-emails', upload.single('file'), async (req, res) => {
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
app.get('/api/send-emails-sse', (req, res) => {
    const email = req.query.email;

    if (!email) {
        return res.status(400).json({success: false, message: 'Email parameter is required'});
    }

    // Set up SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Send initial data if job exists
    const job = emailJobs.get(email);
    if (job) {
        const message = JSON.stringify({
            type: 'progress',
            total: job.total,
            current: job.current,
            success: job.success,
            failed: job.failed
        });
        res.write(`data: ${message}\n\n`);
    }

    // Add this client to our active connections
    const clientId = Date.now();
    const newClient = {id: clientId, email, res};
    clients.set(clientId, newClient);

    // Remove client on connection close
    req.on('close', () => {
        clients.delete(clientId);
    });
});

app.get('/api/user-profile', async (req, res) => {
  try {
  const userProfiles = await UserProfile.find();

  res.status(200).json({ 
    success: true, 
    userProfiles
  });
} catch (error) {
  console.error('Error fetching userProfiles:', error);
  res.status(500).json({ 
    success: false, 
    message: error.message || 'Server error processing request' 
  });
}
});

app.get('/api/email-audit', async (req, res) => {
  try {
    const records = await EmailAudit.find().sort({ createdAt: -1 });
    
    const formattedRecords = records.map(record => ({
      ...record.toObject(),
      emailMetadata: {
        messageId: record.messageId,
        threadId: record.threadId,
        originalMessageId: record.originalMessageId,
        isFollowUp: record.isFollowUp
      }
    }));

    res.status(200).json({ 
      success: true, 
      records: formattedRecords
    });
  } catch (error) {
    console.error('Error fetching email audit:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error processing request' 
    });
  }
});

// Add this new endpoint before app.listen
app.delete('/api/email-audit/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Received delete request for ID:', id);
    
    // Validate if the ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Invalid MongoDB ObjectId format:', id);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid record ID format' 
      });
    }

    console.log('Attempting to delete record with ID:', id);
    const result = await EmailAudit.findByIdAndDelete(id);
    console.log('Delete result:', result);
    
    if (!result) {
      console.log('No record found with ID:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'Record not found' 
      });
    }
    
    console.log('Successfully deleted record with ID:', id);
    res.status(200).json({ 
      success: true, 
      message: 'Record deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting email audit record:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error while deleting record' 
    });
  }
});

// Add new endpoint to update resume link in template
app.post('/api/update-resume-link', async (req, res) => {
  try {
    const { userType, resumeLink } = req.body;
    
    if (!userType || !resumeLink) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type and resume link are required' 
      });
    }

    // Get the current template
    const template = await UserTemplate.findOne({ userProfile: userType });
    
    if (!template) {
      return res.status(404).json({ 
        success: false, 
        message: `No template found for user type: ${userType}` 
      });
    }

    // Replace the old resume link with the new one
    const oldTemplate = template.userTemplate;
    console.log('Updating resume link to:', resumeLink);
    
    // First try to find the existing link
    const linkMatch = oldTemplate.match(/href=["'](https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+\/view)["']/i);
    console.log('Found existing link:', linkMatch);
    
    let newTemplate;
    if (linkMatch) {
      // If found in href, replace it there
      const newLink = resumeLink.startsWith('@') ? resumeLink.substring(1) : resumeLink;
      newTemplate = oldTemplate.replace(
        /href=["']https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+\/view["']/i,
        `href="${newLink}"`
      );
    } else {
      // If not found in href, try the old pattern
      newTemplate = oldTemplate.replace(
        /@https:\/\/drive\.google\.com\/[^\s"'<>]+/g,
        resumeLink
      );
    }
    
    console.log('Template updated successfully');

    // Update the template
    template.userTemplate = newTemplate;
    await template.save();

    res.status(200).json({ 
      success: true, 
      message: 'Resume link updated successfully',
      template: newTemplate
    });

  } catch (error) {
    console.error('Error updating resume link:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error updating resume link' 
    });
  }
});

// Add new endpoint to get resume link from template
app.get('/api/get-resume-link/:userType', async (req, res) => {
  try {
    const { userType } = req.params;
    
    if (!userType) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type is required' 
      });
    }

    // Get the current template
    const template = await UserTemplate.findOne({ userProfile: userType });
    
    if (!template) {
      console.log(`No template found for userType: ${userType}`);
      return res.status(404).json({ 
        success: false, 
        message: `No template found for user type: ${userType}` 
      });
    }

    // Log the full template for debugging
    console.log('Full template content:', template.userTemplate);

    // Extract the Google Drive file ID and construct the full link
    const fileIdMatch = template.userTemplate.match(/file\/d\/([a-zA-Z0-9_-]+)\/view/i);
    console.log('File ID match:', fileIdMatch);
    
    let resumeLink = '';
    if (fileIdMatch && fileIdMatch[1]) {
      const fileId = fileIdMatch[1];
      resumeLink = `@https://drive.google.com/file/d/${fileId}/view`;
    }
    console.log('Final resume link:', resumeLink);

    res.status(200).json({ 
      success: true, 
      resumeLink
    });

  } catch (error) {
    console.error('Error fetching resume link:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error fetching resume link' 
    });
  }
});

// Add new endpoint to get template
app.get('/api/get-template/:userType', async (req, res) => {
  try {
    const { userType } = req.params;
    
    if (!userType) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type is required' 
      });
    }

    // Get the current template
    const template = await UserTemplate.findOne({ userProfile: userType });
    
    if (!template) {
      console.log(`No template found for userType: ${userType}`);
      return res.status(404).json({ 
        success: false, 
        message: `No template found for user type: ${userType}` 
      });
    }

    res.status(200).json({ 
      success: true, 
      template: template.userTemplate
    });

  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error fetching template' 
    });
  }
});

// Add new endpoint to update template
app.post('/api/update-template', async (req, res) => {
  try {
    const { userType, template } = req.body;
    
    if (!userType || !template) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type and template are required' 
      });
    }

    // Find or create template
    let userTemplate = await UserTemplate.findOne({ userProfile: userType });
    
    if (!userTemplate) {
      userTemplate = new UserTemplate({
        userProfile: userType,
        userTemplate: template
      });
    } else {
      userTemplate.userTemplate = template;
    }

    await userTemplate.save();

    res.status(200).json({ 
      success: true, 
      message: 'Template updated successfully',
      template: userTemplate.userTemplate
    });

  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error updating template' 
    });
  }
});

// Add endpoint to get follow-up template
app.get('/api/get-followup-template/:userType', async (req, res) => {
  try {
    const { userType } = req.params;
    
    if (!userType) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type is required' 
      });
    }

    const template = await FollowUpTemplate.findOne({ userProfile: userType });
    
    res.status(200).json({ 
      success: true, 
      followUpTemplate: template ? template.followUpTemplate : null
    });

  } catch (error) {
    console.error('Error fetching follow-up template:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error fetching follow-up template' 
    });
  }
});

// Add endpoint to update follow-up template
app.post('/api/update-followup-template', async (req, res) => {
  try {
    const { userType, template } = req.body;
    
    if (!userType || !template) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type and template are required' 
      });
    }

    let followUpTemplate = await FollowUpTemplate.findOne({ userProfile: userType });
    
    if (!followUpTemplate) {
      followUpTemplate = new FollowUpTemplate({
        userProfile: userType,
        followUpTemplate: template
      });
    } else {
      followUpTemplate.followUpTemplate = template;
    }

    await followUpTemplate.save();

    res.status(200).json({ 
      success: true, 
      message: 'Follow-up template updated successfully',
      template: followUpTemplate.followUpTemplate
    });

  } catch (error) {
    console.error('Error updating follow-up template:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error updating follow-up template' 
    });
  }
});

// Add endpoint to toggle reply received status
app.post('/api/toggle-reply-received/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;
    
    if (!recordId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Record ID is required' 
      });
    }

    const record = await EmailAudit.findById(recordId);
    
    if (!record) {
      return res.status(404).json({ 
        success: false, 
        message: 'Record not found' 
      });
    }

    record.replyReceived = !record.replyReceived;
    await record.save();

    res.status(200).json({ 
      success: true, 
      message: 'Reply received status updated successfully',
      replyReceived: record.replyReceived
    });

  } catch (error) {
    console.error('Error updating reply received status:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error updating reply received status' 
    });
  }
});

// Update the send follow-up endpoint with better error handling
app.post('/api/send-followup', async (req, res) => {
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

    const template = await FollowUpTemplate.findOne({ userProfile: userType });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Follow-up template not found' });
    }

    const transporter = createTransporter(email, password);
    
    // Generate a new Message-ID for the follow-up that references the original
    const domain = email.split('@')[1];
    const newMessageId = `<followup.${Date.now()}.${record.jobId}@${domain}>`;

    const mailOptions = {
      from: `${nameMap[userType]} <${email}>`,
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

// Add endpoint to send bulk follow-ups
app.post('/api/send-bulk-followup', async (req, res) => {
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
    sendToClient(email, {
      type: 'progress',
      total: records.length,
      current: 0,
      success: 0,
      failed: 0
    });

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
        sendToClient(email, {
          type: 'log',
          message: `❌ No template found for user ${userType}`
        });
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
            from: `${nameMap[userType]} <${email}>`,
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
            
            // Send progress update first
            sendToClient(email, {
              type: 'progress',
              total: job.total,
              current: job.current,
              success: job.success,
              failed: job.failed
            });
            
            // Then send success log
            sendToClient(email, {
              type: 'log',
              message: `${job.current}/${job.total}: Successfully sent follow-up email to ${record.email}`
            });
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
            
            // Send error log first with more details
            sendToClient(email, {
              type: 'log',
              message: `${job.current}/${job.total}: Failed to send follow-up to ${record.email}: ${error.message} (${error.code || 'Unknown error'})`
            });
            
            // Then send progress update
            sendToClient(email, {
              type: 'progress',
              total: job.total,
              current: job.current,
              success: job.success,
              failed: job.failed
            });
          }
        }
      }

      // Send completion event
      const job = emailJobs.get(email);
      if (job) {
        sendToClient(email, {
          type: 'complete',
          success: job.success,
          failed: job.failed
        });
        emailJobs.delete(email);
      }

    } catch (error) {
      console.error('Error in bulk follow-up process:', error);
      sendToClient(email, {
        type: 'log',
        message: `❌ Error in bulk follow-up process: ${error.message}`
      });
      const job = emailJobs.get(email);
      if (job) {
        sendToClient(email, {
          type: 'complete',
          success: job.success,
          failed: job.failed
        });
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

// Process email job
async function processEmailJob(email) {
  const job = emailJobs.get(email);

  if (!job) return;
  
  job.status = 'processing';
  
  // Create email transporter
  let transporter;
  try {
    transporter = createTransporter(job.email, job.password);
  } catch (error) {
    console.error('❌ Error creating email transporter:', {
      error: error.message,
      stack: error.stack,
      email: job.email
    });
    
    sendToClient(email, {
      type: 'log',
      message: `Error creating email transporter: ${error.message}`
    });
    
    sendToClient(email, {
      type: 'complete',
      success: 0,
      failed: job.total
    });
    
    emailJobs.delete(email);
    return;
  }
  
  console.log('📧 Starting email job:', {
    jobId: job.jobId,
    totalEmails: job.total,
    userType: job.userType
  });
  
  sendToClient(email, {
    type: 'log',
    message: `Starting email sending process for ${job.total} recipients`
  });
  
  // Process each recipient
  for (let i = 0; i < job.data.length; i++) {
    const row = job.data[i];
    job.current = i + 1;
    
    try {
      // Skip rows with missing required fields
      if (!row.Name || !row.Email || !row.Company || !row.Role) {
        console.warn('⚠️ Skipping invalid row:', {
          rowIndex: i + 1,
          missingFields: {
            name: !row.Name,
            email: !row.Email,
            company: !row.Company,
            role: !row.Role
          }
        });

        sendToClient(email, {
          type: 'log',
          message: `Skipping row ${i + 1}: Missing required fields`
        });

        job.failed++;

        const newJob = new EmailAudit({
          jobId: job.jobId,        
          userProfile: job.userType,  
          name: row.Name || 'Missing',    
          company: row.Company || 'Missing',
          email: row.Email || 'Missing',
          role: row.Role || 'Missing',
          link: row.Link,
          status: "failure",
          errorDetails: "Missing required fields",
          messageId: `error-${Date.now()}-${job.jobId}`,
          threadId: `error-${Date.now()}-${job.jobId}`,
          isFollowUp: false,
          emailType: 'Main Email'
        });
        await newJob.save(); 

        continue;
      }
      
      // Send the email
      const info = await sendEmail(transporter, row, job);
      job.success++;

      console.log('✅ Email sent successfully:', {
        jobId: job.jobId,
        recipient: row.Email,
        progress: `${i + 1}/${job.total}`
      });
      
      sendToClient(email, {
        type: 'log',
        message: `${i + 1}/${job.total}: Successfully sent email to ${row.Email}`
      });
      
    } catch (error) {
      job.failed++;

      console.error('❌ Failed to send email:', {
        jobId: job.jobId,
        recipient: row.Email,
        error: error.message,
        stack: error.stack,
        progress: `${i + 1}/${job.total}`
      });

      const newJob = new EmailAudit({
        jobId: job.jobId,        
        userProfile: job.userType,  
        name: row.Name,    
        company: row.Company,
        email: row.Email,
        role: row.Role,
        link: row.Link,
        status: "failure",
        errorDetails: error.message,
        messageId: `error-${Date.now()}-${job.jobId}`,
        threadId: `error-${Date.now()}-${job.jobId}`,
        isFollowUp: false,
        emailType: 'Main Email'
      });
      await newJob.save(); 

      sendToClient(email, {
        type: 'log',
        message: `${i + 1}/${job.total}: Failed to send email to ${row.Email}: ${error.message}`
      });
    }
  }

  console.log('✨ Email job completed:', {
    jobId: job.jobId,
    totalEmails: job.total,
    success: job.success,
    failed: job.failed
  });

  // Complete the job
  sendToClient(email, {
      type: 'complete',
      success: job.success,
      failed: job.failed
  });

  // Clean up
  emailJobs.delete(email);
}

// Send an individual email
// Fix the custom email template processing in the sendEmail function

async function sendEmail(transporter, row, job) {
    try {
        const from = nameMap[job.userType] || "Interview Opportunity";
        const { Name, Email, Role, Company, Link } = row;
        
        // Fetch the email template for the user type
        const template = await UserTemplate.findOne({ userProfile: job.userType });
        if (!template) {
            throw new Error(`No template found for user type: ${job.userType}`);
        }
        let emailTemplate = template.userTemplate;
        
        // Process template variables
        const firstName = Name.split(' ')[0];
        emailTemplate = emailTemplate
            .replace(/\$\{firstName\}/g, firstName)
            .replace(/\$\{Name\}/g, Name)
            .replace(/\$\{Company\}/g, Company)
            .replace(/\$\{Email\}/g, Email)
            .replace(/\$\{Role\}/g, Role);

        // Handle conditional Link statement
        const linkRegex = /\$\{Link \? `(.*?)` : ''\}/g;
        emailTemplate = emailTemplate.replace(linkRegex, (match, content) => {
            return Link ? content.replace(/\$\{Link\}/g, Link) : '';
        });

        // Replace any remaining ${Link} variables
        emailTemplate = emailTemplate.replace(/\$\{Link\}/g, Link || '');
        
        // Generate message ID before creating mail options
        const domain = job.email.split('@')[1];
        const messageId = `<${Date.now()}.${job.jobId}@${domain}>`;
        
        const mailOptions = {
            from: `${from} <${job.email}>`,
            to: Email,
            subject: `Request for an Interview Opportunity - ${Role} at ${Company}`,
            html: emailTemplate,
            messageId: messageId,
            headers: {
                'Message-ID': messageId,
                'X-Entity-Ref-ID': job.jobId,
                'X-Priority': '1',
                'X-MSMail-Priority': 'High',
                'Importance': 'high'
            }
        };

        console.log('📤 Sending email:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject,
            messageId: messageId
        });

        const info = await transporter.sendMail(mailOptions);
        
        // Create audit record with required fields
        const newJob = new EmailAudit({
            jobId: job.jobId,        
            userProfile: job.userType,
            name: Name,    
            company: Company,
            email: Email,
            role: Role,
            link: Link,
            status: "success",
            messageId: messageId,
            threadId: messageId,
            isFollowUp: false,
            emailType: 'Main Email'
        });

        await newJob.save();
        console.log('✅ Email audit record created:', {
            jobId: job.jobId,
            messageId: messageId,
            threadId: messageId
        });

        return info;
    } catch (error) {
        console.error('❌ Error in sendEmail function:', {
            error: error.message,
            stack: error.stack,
            recipient: Email,
            userType: job.userType
        });
        throw error;
    }
}

// Send updates to connected clients
function sendToClient(email, data) {
    clients.forEach(client => {
        if (client.email === email) {
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    });

    // Also update the job status if it's a progress update
    if (data.type === 'progress') {
        const job = emailJobs.get(email);
        if (job) {
            job.current = data.current;
            job.success = data.success;
            job.failed = data.failed;
        }
    }
}

// Function to fetch email template by userType
async function getEmailTemplate (userType) {
  try {
    const template = await UserTemplate.findOne({ userProfile: userType }); // Fetch based on userType

    if (!template) {
      console.log(`No template found for userType: ${userType}`);
      return null; // Return null if not found
    }

    return template.userTemplate;
  } catch (error) {
    console.error("❌ Error fetching email template:", error);
    throw error; // Throw error for better debugging
  }
}

// Get follow-up template
app.get('/api/followup-template/:userType', async (req, res) => {
  try {
    const { userType } = req.params;
    
    if (!userType) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type is required' 
      });
    }

    const template = await FollowUpTemplate.findOne({ userProfile: userType });
    
    res.status(200).json({ 
      success: true, 
      template: template?.followUpTemplate || ''
    });
  } catch (error) {
    console.error('Error fetching follow-up template:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error fetching follow-up template' 
    });
  }
});

// Save follow-up template
app.post('/api/followup-template', async (req, res) => {
  try {
    const { userProfile, template } = req.body;
    
    if (!userProfile || !template) {
      return res.status(400).json({ 
        success: false, 
        message: 'User profile and template are required' 
      });
    }

    // Update or create template
    await FollowUpTemplate.findOneAndUpdate(
      { userProfile },
      { 
        userProfile,
        followUpTemplate: template,
        lastUpdated: new Date()
      },
      { upsert: true }
    );

    res.status(200).json({ 
      success: true, 
      message: 'Follow-up template saved successfully' 
    });
  } catch (error) {
    console.error('Error saving follow-up template:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error saving follow-up template' 
    });
  }
});

// Add this endpoint after other endpoints
app.post('/api/bulk-mark-reply', async (req, res) => {
  try {
    const { startDate, endDate, userProfile } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'Start date and end date are required' 
      });
    }

    // Create date objects for comparison
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Set to end of day

    // Build the query
    const query = {
      createdAt: { $gte: start, $lte: end },
      replyReceived: false // Only update emails that haven't been marked as replied
    };

    // Add userProfile filter if not 'all'
    if (userProfile !== 'all') {
      query.userProfile = userProfile;
    }

    // Update all matching records
    const result = await EmailAudit.updateMany(
      query,
      { $set: { replyReceived: true } }
    );

    res.status(200).json({ 
      success: true, 
      message: 'Successfully marked emails as replied',
      updatedCount: result.modifiedCount
    });

  } catch (error) {
    console.error('Error marking bulk replies:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error while marking replies' 
    });
  }
});

// Fallback for all other routes to serve React app
// app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
//   });

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
