const express = require('express');
const router = express.Router();
const { createRole, getRoles, updateRole, deleteRole } = require('../controllers/role.controller');
const { validateToken, isAdmin } = require('../utils/validateToken');

// All role routes require Admin authentication
router.post('/', validateToken, isAdmin, createRole);
router.get('/', validateToken, getRoles);
router.put('/:id', validateToken, isAdmin, updateRole);
router.delete('/:id', validateToken, isAdmin, deleteRole);

module.exports = router;
