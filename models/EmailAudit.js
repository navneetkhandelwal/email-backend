const mongoose = require('mongoose');

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
}, { timestamps: true });

module.exports = mongoose.model('email_audits', emailAuditSchema); 