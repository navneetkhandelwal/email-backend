const { v4: uuidv4 } = require('uuid');
const createTransporter = require('../utils/emailTransporter');
const EmailAudit = require('../models/EmailAudit');
const UserTemplate = require('../models/UserTemplate');
const FollowUpTemplate = require('../models/FollowUpTemplate');
const UserProfile = require('../models/UserProfile');

// Store active SSE connections
const clients = new Map();

// Email sending queue and process management
const emailJobs = new Map();

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

async function getEmailTemplate(userType, isFollowUp = false) {
  try {
    // First check if the user profile exists
    const userProfile = await UserProfile.findOne({ name: userType.toLowerCase() });
    if (!userProfile) {
      console.error(`No user profile found for userType: ${userType}`);
      throw new Error(`No user profile found for: ${userType}`);
    }

    // Check for template in user profile
    if (isFollowUp) {
      if (userProfile.followUpTemplate) {
        console.log('Found follow-up template in user profile:', {
          userType,
          templateLength: userProfile.followUpTemplate.length
        });
        return userProfile.followUpTemplate;
      }
    } else {
      if (userProfile.emailTemplate) {
        console.log('Found email template in user profile:', {
          userType,
          templateLength: userProfile.emailTemplate.length
        });
        return userProfile.emailTemplate;
      }
    }

    // If no template in user profile, try the old template system
    const template = isFollowUp 
      ? await FollowUpTemplate.findOne({ userProfile: userType.toLowerCase() })
      : await UserTemplate.findOne({ userProfile: userType.toLowerCase() });

    if (!template) {
      console.error(`No template found for userType: ${userType}`);
      throw new Error(`No template found for user type: ${userType}`);
    }

    const templateContent = isFollowUp ? template.followUpTemplate : template.userTemplate;
    console.log('Found template in old system:', {
      userType,
      templateLength: templateContent.length
    });
    return templateContent;

  } catch (error) {
    console.error('Error fetching email template:', error);
    throw error;
  }
}

async function sendEmail(transporter, row, job) {
  const { email, password, userType, customEmailBody, isFollowUp } = job;
  console.log('Starting sendEmail with:', {
    userType,
    row,
    hasCustomBody: !!customEmailBody,
    isFollowUp
  });

  const template = customEmailBody || await getEmailTemplate(userType, isFollowUp);
  
  if (!template) {
    throw new Error('No email template found');
  }

  const messageId = uuidv4();

  // Get the display name from the user profile
  const userProfile = await UserProfile.findOne({ name: userType.toLowerCase() });
  const senderName = userProfile?.displayName || 'Interview Opportunity';

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

  // Apply all replacements
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

  // Handle conditional Link statement
  const linkRegex = /\$\{Link \? `(.*?)` : ''\}/g;
  emailContent = emailContent.replace(linkRegex, (match, content) => {
    return row.link ? content.replace(/\$\{Link\}/g, row.link) : '';
  });

  // Replace any remaining ${Link} variables
  emailContent = emailContent.replace(/\$\{Link\}/g, row.link || '');
  const subjectLine = userType.toLowerCase() === 'shweta'
  ? `Job Opportunity - ${row.role} at ${row.company}`
  : `Request for an Interview Opportunity - ${row.role} at ${row.company}`;

  const mailOptions = {
    from: `"${senderName}" <${email}>`,
    to: row.email,
    subject: subjectLine,
    html: emailContent,
    messageId: messageId,
    headers: {
        'Message-ID': messageId,
        'X-Entity-Ref-ID': job.jobId,
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
    }
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);

    // Create audit entry
    const audit = new EmailAudit({
      jobId: job.jobId,
      userProfile: userType.toLowerCase(),
      name: row.name,
      company: row.company,
      email: row.email,
      role: row.role,
      link: row.link,
      messageId: messageId,
      threadId: messageId,
      status: 'success',
      isFollowUp: isFollowUp,
      emailType: isFollowUp ? 'Follow-up Email' : 'Main Email'
    });
    await audit.save();

    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    
    // Create audit entry for failed email
    const audit = new EmailAudit({
      jobId: job.jobId,
      userProfile: userType.toLowerCase(),
      name: row.name,
      company: row.company,
      email: row.email,
      role: row.role,
      link: row.link,
      messageId: messageId,
      threadId: threadId,
      status: 'failed',
      errorDetails: error.message,
      isFollowUp: isFollowUp,
      emailType: isFollowUp ? 'Follow-up Email' : 'Main Email'
    });
    await audit.save();

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
          message: `Failed to send email to ${row.email}: ${error.message}`        });
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
  sendToClient,
  getEmailTemplate,
  normalizeData
};

