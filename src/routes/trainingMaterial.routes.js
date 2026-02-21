const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const trainingMaterialController = require('../controllers/trainingMaterial.controller');
const { validateToken } = require('../utils/validateToken');

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads/training');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'training-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, and TXT files are allowed.'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  },
  fileFilter: fileFilter
});

// GET Routes
router.get('/categories', validateToken, trainingMaterialController.getCategories);
router.get('/', validateToken, trainingMaterialController.getTrainingMaterials);
router.get('/:id', validateToken, trainingMaterialController.getTrainingMaterialById);
router.get('/download/:id', validateToken, trainingMaterialController.downloadTrainingMaterial);

// POST Routes (Admin only)
router.post('/upload', validateToken, upload.single('file'), trainingMaterialController.uploadTrainingMaterial);

// PUT Routes (Admin only)
router.put('/:id', validateToken, trainingMaterialController.updateTrainingMaterial);

// DELETE Routes (Admin only)
router.delete('/:id', validateToken, trainingMaterialController.deleteTrainingMaterial);

module.exports = router;
