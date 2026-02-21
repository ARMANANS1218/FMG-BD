const express = require('express');
const router = express.Router();
const { createSnap } = require("../controllers/snapshot.controller");
const upload = require("../utils/uploadSnap");

router.post('/save-snapshot', upload.single('snapshot'), createSnap);

module.exports=router;