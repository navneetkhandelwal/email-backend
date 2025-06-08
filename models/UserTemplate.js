const mongoose = require('mongoose');

const userTemplateSchema = new mongoose.Schema({
  userProfile: { type: String, required: true },
  userTemplate: { type: String, required: true }
});

module.exports = mongoose.model('user_templates', userTemplateSchema); 