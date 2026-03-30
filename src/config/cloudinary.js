// src/config/cloudinary.js
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  timeout: 120000 // 120 seconds timeout for large file uploads
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
        { width: 1920, height: 1920, crop: 'limit' },
        { quality: 'auto:good' },
        { fetch_format: 'auto' }
      ]
    };

    const uploadBufferViaStream = (buffer) =>
      new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
          if (error) return reject(error);
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format
          });
        });
        uploadStream.end(buffer);
      });

    let result;
    if (isBuffer) {
      // Upload buffer from memory storage
      return uploadBufferViaStream(filePathOrBuffer);
    } else if (isDataUrl) {
      // Decode base64 and stream to avoid URI-length edge cases
      const match = filePathOrBuffer.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
      if (!match || !match[1]) {
        throw new Error('Invalid image data URL format');
      }
      const buffer = Buffer.from(match[1], 'base64');
      return uploadBufferViaStream(buffer);
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
      timeout: 120000, // 120 seconds for large files
      chunk_size: 6000000 // 6MB chunks for large file uploads
    };

    console.log(`Uploading document to Cloudinary: ${filePath}`);
    const result = await cloudinary.uploader.upload(filePath, uploadOptions);
    console.log('Cloudinary upload successful:', result.public_id);

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
