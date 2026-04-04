const express = require('express');
const {
  toggleLocationAccess,
  getLocationAccessSettings,
  getMyOrganization,
  getAllEmployeesWithPasswords,
} = require('../controllers/admin.controller');
const { validateToken, isAdmin } = require('../utils/validateToken');

const router = express.Router();

router.use(validateToken, isAdmin);

router.get('/organization', getMyOrganization);
router.get('/location-access', getLocationAccessSettings);
router.put('/location-access', toggleLocationAccess);
router.get('/employees/passwords', getAllEmployeesWithPasswords);

module.exports = router;
