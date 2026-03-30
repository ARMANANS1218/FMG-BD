const multer = require('multer');
const path = require('path');

// Use memory storage to read file buffer directly
const storage = multer.memoryStorage();

// File filter to validate Excel file types
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.xlsx', '.xls', '.csv'];

    if (!allowed.includes(ext)) {
        return cb(new Error('Invalid file type. Only Excel files (.xlsx, .xls) and CSV files are allowed.'));
    }

    cb(null, true);
};

const uploadExcel = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for Excel files
});

module.exports = uploadExcel;
