const multer = require('multer');
const path = require('path');
const { cloudinary } = require('../config/cloudinary');
const streamifier = require('streamifier');

// Use memory storage for Cloudinary uploads
const storage = multer.memoryStorage();

// File filter - Allow images, PDFs, Excel, Word, and other common document formats
const fileFilter = (req, file, cb) => {
  // Allowed file extensions
  const allowedExtensions = /jpeg|jpg|png|gif|webp|bmp|svg|pdf|doc|docx|xls|xlsx|xlsm|csv|ppt|pptx|txt|rtf|zip|rar|7z/;
  
  // Allowed MIME types
  const allowedMimeTypes = [
    // Images
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
    // PDFs
    'application/pdf',
    // Word documents
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    // Excel documents
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm
    'text/csv',
    // PowerPoint
    'application/vnd.ms-powerpoint', // .ppt
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    // Text files
    'text/plain', 'text/rtf', 'application/rtf',
    // Archives
    'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/x-7z-compressed'
  ];
  
  const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedMimeTypes.includes(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error(`File type not allowed. Allowed types: Images (JPEG, PNG, GIF, WebP, BMP, SVG), Documents (PDF, DOC, DOCX, XLS, XLSX, XLSM, CSV, PPT, PPTX, TXT, RTF), Archives (ZIP, RAR, 7Z)`));
  }
};

// Multer upload configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size per file
    files: 10 // Maximum 10 files per request
  }
});

// Upload file buffer to Cloudinary
const uploadToCloudinary = (fileBuffer, originalname, mimetype) => {
  return new Promise((resolve, reject) => {
    // Determine resource type and folder
    const isImage = mimetype.startsWith('image/');
    // Use 'raw' for PDFs to avoid authentication issues, 'auto' for others
    const resourceType = mimetype === 'application/pdf' ? 'raw' : 'auto';
    const folder = 'ticket-attachments';
    // Sanitize filename for public_id (no spaces/parentheses)
    const safeName = String(originalname)
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    
    // Remove extension from public_id to prevent double extensions
    // Cloudinary automatically adds extension to URLs based on resource type
    const nameWithoutExt = safeName.replace(/\.[^.]+$/, '');

    const uploadOptions = {
      folder: folder,
      resource_type: resourceType,
      public_id: `${Date.now()}-${nameWithoutExt}`
      // Do not force format; let Cloudinary infer from content
    };

    console.log('[Cloudinary Upload] Options:', uploadOptions);
    
    // Create upload stream
    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error('❌ Cloudinary upload error:', error);
          reject(new Error('Failed to upload to Cloudinary: ' + error.message));
        } else {
          console.log('✅ Cloudinary upload success:', { 
            public_id: result.public_id, 
            secure_url: result.secure_url,
            resource_type: result.resource_type,
            format: result.format,
            bytes: result.bytes
          });
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            resourceType: result.resource_type,
            bytes: result.bytes
          });
        }
      }
    );

    // Pipe buffer to upload stream
    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

module.exports = { upload, uploadToCloudinary };
