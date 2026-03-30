const CallScreenshot = require('../models/CallScreenshot');
const path = require('path');
const fs = require('fs');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// Upload and save call screenshot
exports.uploadScreenshot = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No screenshot file provided' });
    }

    const { roomId, petitionId, participants, metadata } = req.body;
    const capturedBy = req.user.id;

    if (!roomId) {
      // Remove uploaded file if validation fails
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }

    // Parse participants if sent as string
    let parsedParticipants = [];
    if (participants) {
      try {
        const rawParticipants = typeof participants === 'string' 
          ? JSON.parse(participants) 
          : participants;
        
        // Filter and validate participants - only include valid ObjectIds
        parsedParticipants = rawParticipants.filter(p => {
          // Check if userId exists and is a valid ObjectId format (24 char hex string)
          if (p.userId && typeof p.userId === 'string' && /^[0-9a-fA-F]{24}$/.test(p.userId)) {
            return true;
          }
          console.warn('⚠️ Skipping invalid participant:', p);
          return false;
        });
      } catch (err) {
        console.error('Participants parse error:', err);
      }
    }

    // Parse metadata if sent as string
    let parsedMetadata = {};
    if (metadata) {
      try {
        parsedMetadata = typeof metadata === 'string' 
          ? JSON.parse(metadata) 
          : metadata;
      } catch (err) {
        console.error('Metadata parse error:', err);
      }
    }

    // Upload to Cloudinary
    console.log('📤 Uploading screenshot to Cloudinary...');
    const cloudinaryResult = await uploadToCloudinary(req.file.path, 'call-screenshots');
    
    // Delete local file after successful upload
    fs.unlinkSync(req.file.path);
    console.log('✅ Screenshot uploaded to Cloudinary:', cloudinaryResult.url);

    const screenshot = await CallScreenshot.create({
      roomId,
      petitionId: petitionId || undefined,
      capturedBy,
      participants: parsedParticipants,
      imagePath: req.file.filename, // Keep for backward compatibility
      imageUrl: cloudinaryResult.url,
      cloudinaryPublicId: cloudinaryResult.publicId,
      callType: 'video',
      metadata: {
        ...parsedMetadata,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype
      }
    });

    const populated = await CallScreenshot.findById(screenshot._id)
      .populate('capturedBy', 'name email role')
      .populate('participants.userId', 'name email role');

    res.status(201).json({ 
      success: true, 
      message: 'Screenshot saved successfully',
      data: populated 
    });
  } catch (error) {
    console.error('Upload Screenshot Error:', error);
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: 'Failed to save screenshot' });
  }
};

// Get all screenshots (for agents/QA with filters)
exports.getAllScreenshots = async (req, res) => {
  try {
    const { roomId, petitionId, limit = 50, page = 1 } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    const filter = {};
    
    // Non-admins (except QA/TL) can only see their own screenshots
    if (!['Admin', 'QA', 'TL', 'Agent'].includes(userRole)) {
      filter.capturedBy = userId;
    }

    if (roomId) filter.roomId = roomId;
    if (petitionId) filter.petitionId = petitionId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const screenshots = await CallScreenshot.find(filter)
      .populate('capturedBy', 'name email role profileImage')
      .populate('participants.userId', 'name email role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await CallScreenshot.countDocuments(filter);

    res.json({ 
      success: true, 
      data: screenshots,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get Screenshots Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get screenshot by ID
exports.getScreenshotById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const screenshot = await CallScreenshot.findById(id)
      .populate('capturedBy', 'name email role profileImage')
      .populate('participants.userId', 'name email role');

    if (!screenshot) {
      return res.status(404).json({ success: false, message: 'Screenshot not found' });
    }

    // Check authorization
    if (!['Admin', 'QA', 'TL'].includes(userRole) && screenshot.capturedBy._id.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: screenshot });
  } catch (error) {
    console.error('Get Screenshot By ID Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete screenshot
exports.deleteScreenshot = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const screenshot = await CallScreenshot.findById(id);

    if (!screenshot) {
      return res.status(404).json({ success: false, message: 'Screenshot not found' });
    }

    // Check authorization - only owner or Admin/QA/TL can delete
    if (!['Admin', 'QA', 'TL'].includes(userRole) && screenshot.capturedBy.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Delete from Cloudinary if publicId exists
    if (screenshot.cloudinaryPublicId) {
      try {
        console.log('🗑️ Deleting from Cloudinary:', screenshot.cloudinaryPublicId);
        await deleteFromCloudinary(screenshot.cloudinaryPublicId);
        console.log('✅ Deleted from Cloudinary');
      } catch (cloudError) {
        console.error('Cloudinary delete error:', cloudError);
        // Continue with database deletion even if Cloudinary deletion fails
      }
    }

    // Delete file from local filesystem (fallback for old screenshots)
    const filePath = path.join(__dirname, '../../uploads/call-screenshots', screenshot.imagePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await CallScreenshot.findByIdAndDelete(id);

    res.json({ success: true, message: 'Screenshot deleted successfully' });
  } catch (error) {
    console.error('Delete Screenshot Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get screenshots for a specific query/petition
exports.getScreenshotsByPetition = async (req, res) => {
  try {
    const { petitionId } = req.params;

    const screenshots = await CallScreenshot.find({ petitionId })
      .populate('capturedBy', 'name email role profileImage')
      .populate('participants.userId', 'name email role')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: screenshots });
  } catch (error) {
    console.error('Get Screenshots By Petition Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
