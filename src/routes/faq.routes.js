const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faq.controller');
const { authenticateToken } = require('../middleware/tenantAuth');

// All routes require authentication
router.use(authenticateToken);

// Get all FAQs and Common Replies for organization
// Query param: ?type=common or ?type=faq (optional)
router.get('/', faqController.getFaqs);

// Create new FAQ or Common Reply (QA and TL only)
router.post('/', faqController.createFaq);

// Update FAQ or Common Reply (QA and TL only)
router.put('/:id', faqController.updateFaq);

// Delete FAQ or Common Reply (QA and TL only)
router.delete('/:id', faqController.deleteFaq);

module.exports = router;
