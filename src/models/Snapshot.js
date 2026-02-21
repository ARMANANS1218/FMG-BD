const mongoose = require('mongoose');

const snapshotSchema = new mongoose.Schema({
  snapshot: {
    data: Buffer,
    contentType: String,
    fileName: String,
    filePath: String
  }
}, { timestamps: true });

module.exports = mongoose.model('Snapshot', snapshotSchema);
