const express = require('express');
const router = express.Router();
const UserTemplate = require('../models/UserTemplate');
const FollowUpTemplate = require('../models/FollowUpTemplate');

// Get template
router.get('/get-template/:userType', async (req, res) => {
  try {
    const { userType } = req.params;
    
    if (!userType) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type is required' 
      });
    }

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

// Update template
router.post('/update-template', async (req, res) => {
  try {
    const { userType, template } = req.body;
    
    if (!userType || !template) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type and template are required' 
      });
    }

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

// Get follow-up template
router.get('/get-followup-template/:userType', async (req, res) => {
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

// Update follow-up template
router.post('/update-followup-template', async (req, res) => {
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

// Update resume link in template
router.post('/update-resume-link', async (req, res) => {
  try {
    const { userType, resumeLink } = req.body;
    
    if (!userType || !resumeLink) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type and resume link are required' 
      });
    }

    const template = await UserTemplate.findOne({ userProfile: userType });
    
    if (!template) {
      return res.status(404).json({ 
        success: false, 
        message: `No template found for user type: ${userType}` 
      });
    }

    const oldTemplate = template.userTemplate;
    console.log('Updating resume link to:', resumeLink);
    
    const linkMatch = oldTemplate.match(/href=["'](https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+\/view)["']/i);
    console.log('Found existing link:', linkMatch);
    
    let newTemplate;
    if (linkMatch) {
      const newLink = resumeLink.startsWith('@') ? resumeLink.substring(1) : resumeLink;
      newTemplate = oldTemplate.replace(
        /href=["']https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+\/view["']/i,
        `href="${newLink}"`
      );
    } else {
      newTemplate = oldTemplate.replace(
        /@https:\/\/drive\.google\.com\/[^\s"'<>]+/g,
        resumeLink
      );
    }
    
    console.log('Template updated successfully');

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

// Get resume link from template
router.get('/get-resume-link/:userType', async (req, res) => {
  try {
    const { userType } = req.params;
    
    if (!userType) {
      return res.status(400).json({ 
        success: false, 
        message: 'User type is required' 
      });
    }

    const template = await UserTemplate.findOne({ userProfile: userType });
    
    if (!template) {
      console.log(`No template found for userType: ${userType}`);
      return res.status(404).json({ 
        success: false, 
        message: `No template found for user type: ${userType}` 
      });
    }

    console.log('Full template content:', template.userTemplate);

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

// Alias for frontend compatibility
router.get('/followup-template/:userType', async (req, res) => {
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
      template: template ? template.followUpTemplate : null
    });
  } catch (error) {
    console.error('Error fetching follow-up template:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error fetching follow-up template' 
    });
  }
});

module.exports = router; 