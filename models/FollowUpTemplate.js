const mongoose = require('mongoose');

const followUpTemplateSchema = new mongoose.Schema({
  userProfile: { type: String, required: true },
  followUpTemplate: { type: String, required: true },
  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('followup_templates', followUpTemplateSchema); 