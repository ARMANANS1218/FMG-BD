// src/config/cloudinary.js
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Upload image to Cloudinary
const uploadToCloudinary = async (filePathOrBuffer, folder = 'call-screenshots') => {
  try {
    // Check if input is a buffer (from multer memory storage)
    const isBuffer = Buffer.isBuffer(filePathOrBuffer);
    // Check if input is a data URL
    const isDataUrl = typeof filePathOrBuffer === 'string' && filePathOrBuffer.startsWith('data:');
    
    const uploadOptions = {
      folder: folder,
      resource_type: 'image',
      transformation: [
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    };

    let result;
    if (isBuffer) {
      // Upload buffer from memory storage
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) reject(error);
            else resolve({
              url: result.secure_url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
              format: result.format
            });
          }
        );
        uploadStream.end(filePathOrBuffer);
      });
    } else if (isDataUrl) {
      // Upload data URL directly
      result = await cloudinary.uploader.upload(filePathOrBuffer, uploadOptions);
    } else {
      // Upload file path
      result = await cloudinary.uploader.upload(filePathOrBuffer, uploadOptions);
    }

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image to Cloudinary: ' + (error.message || error));
  }
};

// Upload document to Cloudinary (PDF, DOC, XLS, PPT, etc.)
const uploadDocumentToCloudinary = async (filePath, folder = 'training-materials') => {
  try {
    const uploadOptions = {
      folder: folder,
      resource_type: 'raw', // Use 'raw' for documents to enable direct download
      type: 'upload',
      flags: 'attachment', // Force download instead of inline display
    };

    const result = await cloudinary.uploader.upload(filePath, uploadOptions);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes
    };
  } catch (error) {
    console.error('Cloudinary document upload error:', error);
    throw new Error('Failed to upload document to Cloudinary: ' + (error.message || error));
  }
};

// Delete image from Cloudinary
const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error('Failed to delete image from Cloudinary');
  }
};

// Delete document from Cloudinary
const deleteDocumentFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    return result;
  } catch (error) {
    console.error('Cloudinary document delete error:', error);
    throw new Error('Failed to delete document from Cloudinary');
  }
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
  deleteFromCloudinary,
  uploadDocumentToCloudinary,
  deleteDocumentFromCloudinary
};
