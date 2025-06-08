const express = require('express');
const router = express.Router();
const UserProfile = require('../models/UserProfile');

// GET /api/user-profile
router.get('/user-profile', async (req, res) => {
  try {
    const userProfiles = await UserProfile.find({}, { _id: 0, userId: 1, name: 1 });
    res.status(200).json({ userProfiles });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch user profiles', error: error.message });
  }
});

module.exports = router; 