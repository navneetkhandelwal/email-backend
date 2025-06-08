const express = require('express');
const router = express.Router();
const UserProfile = require('../models/UserProfile');

// Get current user's profile
router.get('/me', async (req, res) => {
  try {
    // Get the user's email from the auth token
    const userEmail = req.user.email;
    if (!userEmail) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Find profile by email
    const profile = await UserProfile.findOne({ email: userEmail });
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all user profiles
router.get('/', async (req, res) => {
  try {
    const userProfiles = await UserProfile.find();
    res.status(200).json({ userProfiles });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user profile by ID
router.get('/:id', async (req, res) => {
  try {
    const profile = await UserProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new user profile
router.post('/', async (req, res) => {
  try {
    const { userId, name, displayName, resumeLink, emailTemplate, followUpTemplate } = req.body;

    // Validate required fields
    if (!userId || !name || !displayName) {
      return res.status(400).json({ 
        message: 'userId, name, and displayName are required' 
      });
    }

    const profile = new UserProfile({
      userId,
      name: name.toLowerCase(),
      displayName,
      resumeLink: resumeLink || '',
      emailTemplate: emailTemplate || '',
      followUpTemplate: followUpTemplate || ''
    });

    const newProfile = await profile.save();
    res.status(201).json(newProfile);
  } catch (error) {
    console.error('Error creating profile:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update user profile
router.patch('/:id', async (req, res) => {
  try {
    const profile = await UserProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Update fields if provided
    if (req.body.name) profile.name = req.body.name.toLowerCase();
    if (req.body.displayName) profile.displayName = req.body.displayName;
    if (req.body.resumeLink !== undefined) profile.resumeLink = req.body.resumeLink;
    if (req.body.emailTemplate !== undefined) profile.emailTemplate = req.body.emailTemplate;
    if (req.body.followUpTemplate !== undefined) profile.followUpTemplate = req.body.followUpTemplate;

    const updatedProfile = await profile.save();
    res.json(updatedProfile);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete user profile
router.delete('/:id', async (req, res) => {
  try {
    const profile = await UserProfile.findByIdAndDelete(req.params.id);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }
    res.json({ message: 'Profile deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 