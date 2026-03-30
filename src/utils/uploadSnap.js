const multer = require('multer');

const storage = multer.diskStorage({
  destination: './uploads/snapshot',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'snap-' + uniqueSuffix + '.jpg');
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

module.exports = upload;