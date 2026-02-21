const multer = require('multer');
const path = require('path');

// Use memory storage for Cloudinary uploads
const storage = multer.memoryStorage();

// File filter to validate image types
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.webp', '.avif', '.png'];

    if (!allowed.includes(ext)) {
        return cb(new Error('Invalid file type. Only JPG, JPEG, WEBP, AVIF, and PNG are allowed.'));
    }

    cb(null, true);
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

module.exports = upload;