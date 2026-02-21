const TrainingMaterial = require('../models/TrainingMaterial');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');
const { uploadDocumentToCloudinary, deleteDocumentFromCloudinary } = require('../config/cloudinary');

// GET ALL CATEGORIES (for dropdown/selection)
exports.getCategories = async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId);

    if (!user || !['Admin', 'TL', 'QA'].includes(user.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const categories = await TrainingMaterial.distinct('category', {
      organizationId: user.organizationId,
      isActive: true
    });

    res.status(200).json({
      status: true,
      data: categories.sort()
    });
  } catch (error) {
    console.error('Get Categories Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get categories', error: error.message });
  }
};

// GET ALL TRAINING MATERIALS (with optional category filter)
exports.getTrainingMaterials = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { category } = req.query;

    const user = await User.findById(userId);
    if (!user || !['Admin', 'TL', 'QA'].includes(user.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const query = {
      organizationId: user.organizationId,
      isActive: true
    };

    if (category) {
      query.category = category;
    }

    const materials = await TrainingMaterial.find(query)
      .populate('uploadedBy', 'name email role')
      .sort({ category: 1, createdAt: -1 });

    res.status(200).json({
      status: true,
      data: materials
    });
  } catch (error) {
    console.error('Get Training Materials Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get training materials', error: error.message });
  }
};

// GET SINGLE TRAINING MATERIAL BY ID
exports.getTrainingMaterialById = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const user = await User.findById(userId);
    if (!user || !['Admin', 'TL', 'QA'].includes(user.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const material = await TrainingMaterial.findOne({
      _id: id,
      organizationId: user.organizationId
    }).populate('uploadedBy', 'name email role');

    if (!material) {
      return res.status(404).json({ status: false, message: 'Training material not found' });
    }

    res.status(200).json({
      status: true,
      data: material
    });
  } catch (error) {
    console.error('Get Training Material Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get training material', error: error.message });
  }
};

// UPLOAD TRAINING MATERIAL (Admin only)
exports.uploadTrainingMaterial = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { category, title, description } = req.body;

    const user = await User.findById(userId);
    if (!user || user.role !== 'Admin') {
      return res.status(403).json({ status: false, message: 'Only Admin can upload training materials' });
    }

    if (!req.file) {
      return res.status(400).json({ status: false, message: 'No file uploaded' });
    }

    if (!category || !title) {
      return res.status(400).json({ status: false, message: 'Category and title are required' });
    }

    // Get file extension
    const fileExt = path.extname(req.file.originalname).toLowerCase().slice(1);
    const allowedExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'];
    
    let fileType = 'other';
    if (allowedExtensions.includes(fileExt)) {
      fileType = fileExt;
    }

    // Upload to Cloudinary
    const cloudinaryResult = await uploadDocumentToCloudinary(req.file.path, 'training-materials');

    // Delete local file after upload
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    const material = await TrainingMaterial.create({
      organizationId: user.organizationId,
      category: category.trim(),
      title: title.trim(),
      description: description ? description.trim() : null,
      fileName: req.file.originalname,
      fileUrl: cloudinaryResult.url,
      fileType,
      fileSize: cloudinaryResult.bytes,
      uploadedBy: userId,
      uploadedByName: user.name,
      cloudinaryPublicId: cloudinaryResult.publicId
    });

    const populatedMaterial = await TrainingMaterial.findById(material._id)
      .populate('uploadedBy', 'name email role');

    res.status(201).json({
      status: true,
      message: 'Training material uploaded successfully',
      data: populatedMaterial
    });
  } catch (error) {
    console.error('Upload Training Material Error:', error);
    // Delete uploaded local file if database operation fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ status: false, message: 'Failed to upload training material', error: error.message });
  }
};

// UPDATE TRAINING MATERIAL (Admin only - can update category, title, description)
exports.updateTrainingMaterial = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { category, title, description } = req.body;

    const user = await User.findById(userId);
    if (!user || user.role !== 'Admin') {
      return res.status(403).json({ status: false, message: 'Only Admin can update training materials' });
    }

    const material = await TrainingMaterial.findOne({
      _id: id,
      organizationId: user.organizationId
    });

    if (!material) {
      return res.status(404).json({ status: false, message: 'Training material not found' });
    }

    // Update fields
    if (category) material.category = category.trim();
    if (title) material.title = title.trim();
    if (description !== undefined) material.description = description ? description.trim() : null;

    await material.save();

    const updatedMaterial = await TrainingMaterial.findById(material._id)
      .populate('uploadedBy', 'name email role');

    res.status(200).json({
      status: true,
      message: 'Training material updated successfully',
      data: updatedMaterial
    });
  } catch (error) {
    console.error('Update Training Material Error:', error);
    res.status(500).json({ status: false, message: 'Failed to update training material', error: error.message });
  }
};

// DELETE TRAINING MATERIAL (Admin only)
exports.deleteTrainingMaterial = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const user = await User.findById(userId);
    if (!user || user.role !== 'Admin') {
      return res.status(403).json({ status: false, message: 'Only Admin can delete training materials' });
    }

    const material = await TrainingMaterial.findOne({
      _id: id,
      organizationId: user.organizationId
    });

    if (!material) {
      return res.status(404).json({ status: false, message: 'Training material not found' });
    }

    // Delete file from Cloudinary
    if (material.cloudinaryPublicId) {
      try {
        await deleteDocumentFromCloudinary(material.cloudinaryPublicId);
      } catch (error) {
        console.error('Error deleting from Cloudinary:', error);
        // Continue with database deletion even if Cloudinary deletion fails
      }
    }

    // Delete from database
    await TrainingMaterial.findByIdAndDelete(id);

    res.status(200).json({
      status: true,
      message: 'Training material deleted successfully'
    });
  } catch (error) {
    console.error('Delete Training Material Error:', error);
    res.status(500).json({ status: false, message: 'Failed to delete training material', error: error.message });
  }
};

// DOWNLOAD TRAINING MATERIAL
exports.downloadTrainingMaterial = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const user = await User.findById(userId);
    if (!user || !['Admin', 'TL', 'QA'].includes(user.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const material = await TrainingMaterial.findOne({
      _id: id,
      organizationId: user.organizationId,
      isActive: true
    });

    if (!material) {
      return res.status(404).json({ status: false, message: 'Training material not found' });
    }

    // Redirect to Cloudinary URL for direct download
    res.redirect(material.fileUrl);
  } catch (error) {
    console.error('Download Training Material Error:', error);
    res.status(500).json({ status: false, message: 'Failed to download training material', error: error.message });
  }
};
