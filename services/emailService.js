const { v4: uuidv4 } = require('uuid');
const createTransporter = require('../utils/emailTransporter');
const EmailAudit = require('../models/EmailAudit');
const UserTemplate = require('../models/UserTemplate');
const FollowUpTemplate = require('../models/FollowUpTemplate');

// Store active SSE connections
const clients = new Map();

// Email sending queue and process management
const emailJobs = new Map();

// Name mapping for email senders
const nameMap = {
  'navneet': 'Navneet Khandelwal',
  'teghdeep': 'Teghdeep Kapoor',
  'divyam': 'Divyam Shrivastava',
  'dhananjay': 'Dhananjay Sharma',
  'akash': 'Akash Rana',
  'avi': 'Avi Kapoor',
  'komal': 'Komal Shrivastava',
  'pooja': 'Pooja Sharma',
  'other': 'Interview Opportunity'
};

// Function to normalize data fields
function normalizeData(data) {
  return data.map(row => ({
    name: row.name || row.Name,
    company: row.company || row.Company,
    email: row.email || row.Email,
    role: row.role || row.Role,
    link: row.link || row.Link
  }));
}

async function getEmailTemplate(userType) {
  try {
    const template = await UserTemplate.findOne({ userProfile: userType });
    if (!template) {
      console.error(`No template found for userType: ${userType}`);
      return null;
    }
    console.log('Found template:', {
      userType,
      template: template.userTemplate,
      length: template.userTemplate.length,
      containsDollarSign: template.userTemplate.includes('${'),
      containsDoubleCurly: template.userTemplate.includes('{{'),
      hasFirstName: template.userTemplate.includes('${firstName}'),
      hasRole: template.userTemplate.includes('${Role}'),
      hasCompany: template.userTemplate.includes('${Company}')
    });
    return template.userTemplate;
  } catch (error) {
    console.error('Error fetching email template:', error);
    return null;
  }
}

async function sendEmail(transporter, row, job) {
  const { email, password, userType, customEmailBody } = job;
  console.log('Starting sendEmail with:', {
    userType,
    row,
    hasCustomBody: !!customEmailBody
  });

  const template = customEmailBody || await getEmailTemplate(userType);
  
  if (!template) {
    throw new Error('No email template found');
  }

  const messageId = uuidv4();
  const threadId = uuidv4();
  const senderName = nameMap[userType] || nameMap.other;

  // Replace template variables
  let emailContent = template;
  const replacements = {
    // Match exact variable names from template
    '${firstName}': row.name || '',
    '${Role}': row.role || '',
    '${Company}': row.company || '',
    // Keep other formats for backward compatibility
    '${name}': row.name || '',
    '${Name}': row.name || '',
    '${company}': row.company || '',
    '${role}': row.role || '',
    '${link}': row.link || '',
    '${Link}': row.link || '',
    '{{name}}': row.name || '',
    '{{company}}': row.company || '',
    '{{role}}': row.role || '',
    '{{link}}': row.link || ''
  };

  console.log('Template before replacement:', {
    content: emailContent,
    containsDollarSign: emailContent.includes('${'),
    containsDoubleCurly: emailContent.includes('{{'),
    hasFirstName: emailContent.includes('${firstName}'),
    hasRole: emailContent.includes('${Role}'),
    hasCompany: emailContent.includes('${Company}'),
    variables: {
      name: row.name,
      company: row.company,
      role: row.role,
      link: row.link
    }
  });

  // Replace all variables
  Object.entries(replacements).forEach(([key, value]) => {
    // Escape special characters in the key for regex
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedKey, 'g');
    const before = emailContent;
    emailContent = emailContent.replace(regex, value);
    if (before !== emailContent) {
      console.log(`Replaced ${key} with ${value}`);
    }
  });

  console.log('Template after replacement:', {
    content: emailContent,
    containsDollarSign: emailContent.includes('${'),
    containsDoubleCurly: emailContent.includes('{{'),
    hasFirstName: emailContent.includes('${firstName}'),
    hasRole: emailContent.includes('${Role}'),
    hasCompany: emailContent.includes('${Company}')
  });

  const mailOptions = {
    from: `"${senderName}" <${email}>`,
    to: row.email,
    subject: `Interview Opportunity at ${row.company}`,
    html: emailContent,
    headers: {
      'Message-ID': messageId,
      'Thread-ID': threadId
    }
  };

  try {
    console.log('Sending email to:', row.email);
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    
    await EmailAudit.create({
      jobId: job.jobId,
      userProfile: userType,
      name: row.name,
      company: row.company,
      email: row.email,
      role: row.role,
      link: row.link,
      status: 'success',
      messageId,
      threadId,
      emailType: 'initial'
    });
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    await EmailAudit.create({
      jobId: job.jobId,
      userProfile: userType,
      name: row.name,
      company: row.company,
      email: row.email,
      role: row.role,
      link: row.link,
      status: 'failed',
      errorDetails: error.message,
      messageId,
      threadId,
      emailType: 'initial'
    });
    throw error;
  }
}

function sendToClient(email, data) {
  const client = clients.get(email);
  if (client) {
    try {
      // Ensure data has a type field
      const messageData = {
        type: data.type || 'progress',
        ...data
      };
      
      // Format the SSE message
      const message = `data: ${JSON.stringify(messageData)}\n\n`;
      client.write(message);
      
      // Log the message for debugging
      console.log('Sent SSE message:', messageData);
    } catch (error) {
      console.error('Error sending to client:', error);
      // Clean up the client connection on error
      clients.delete(email);
    }
  } else {
    console.warn('No client found for email:', email);
  }
}

async function processEmailJob(email) {
  const job = emailJobs.get(email);
  if (!job) {
    console.error('No job found for email:', email);
    return;
  }

  try {
    console.log('Starting email job for:', email);
    const transporter = createTransporter(job.email, job.password);
    job.status = 'processing';

    // Normalize the data before processing
    const normalizedData = normalizeData(job.data);
    job.data = normalizedData;

    // Send initial progress
    sendToClient(email, {
      type: 'progress',
      status: 'processing',
      current: 0,
      total: job.data.length,
      success: 0,
      failed: 0
    });

    for (let i = 0; i < job.data.length; i++) {
      const row = job.data[i];
      try {
        await sendEmail(transporter, row, job);
        job.success++;
        
        // Send success message
        sendToClient(email, {
          type: 'log',
          message: `Successfully sent email to ${row.email}`
        });
      } catch (error) {
        console.error(`Failed to send email to ${row.email}:`, error);
        job.failed++;
        
        // Send error message
        sendToClient(email, {
          type: 'log',
          message: `Failed to send email to ${row.email}: ${error.message}`
        });
      }
      
      job.current = i + 1;
      sendToClient(email, {
        type: 'progress',
        status: 'processing',
        current: job.current,
        total: job.total,
        success: job.success,
        failed: job.failed
      });
    }

    job.status = 'completed';
    sendToClient(email, {
      type: 'complete',
      status: 'completed',
      current: job.current,
      total: job.total,
      success: job.success,
      failed: job.failed
    });
  } catch (error) {
    console.error('Error in processEmailJob:', error);
    job.status = 'failed';
    sendToClient(email, {
      type: 'error',
      status: 'failed',
      error: error.message
    });
  }
}

module.exports = {
  emailJobs,
  clients,
  processEmailJob,
  sendToClient
}; 