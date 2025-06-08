const express = require('express');
const router = express.Router();
const EmailAudit = require('../models/EmailAudit');
const mongoose = require('mongoose');

// Get email audit records
router.get('/email-audit', async (req, res) => {
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

// Delete email audit record
router.delete('/email-audit/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Received delete request for ID:', id);
    
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

// Toggle reply received status
router.post('/toggle-reply-received/:recordId', async (req, res) => {
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

// Bulk mark replies
router.post('/bulk-mark-reply', async (req, res) => {
  try {
    const { startDate, endDate, userProfile } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'Start date and end date are required' 
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const query = {
      createdAt: { $gte: start, $lte: end },
      replyReceived: false
    };

    if (userProfile !== 'all') {
      query.userProfile = userProfile;
    }

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

module.exports = router; 