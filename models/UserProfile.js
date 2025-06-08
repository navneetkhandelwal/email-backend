const mongoose = require('mongoose');

const userProfileSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
});

module.exports = mongoose.model('user_profiles', userProfileSchema); 