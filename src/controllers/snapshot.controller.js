const Snapshot = require('../models/Snapshot');
const path = require('path');

exports.createSnap = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const newSnapshot = new Snapshot({
      snapshot: {
        data: req.file.buffer,
        contentType: req.file.mimetype,
        fileName: req.file.filename,
        filePath: `/uploads/snapshot/${req.file.filename}`
      }
    });

    await newSnapshot.save();

    res.status(201).json({
      success: true,
      message: 'Snapshot saved successfully',
      snapshotId: newSnapshot._id,
      filePath: newSnapshot.snapshot.filePath
    });
  } catch (error) {
    console.error('Error saving snapshot:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving snapshot',
    });
  }
};
