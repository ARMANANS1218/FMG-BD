const express=require("express");
const router=express.Router();
const { getNotifications, markNotificationAsRead } = require("../controllers/notification.controller");
const { validateToken } = require("../utils/validateToken");

// GET /api/notifications?limit=20&page=1&unreadOnly=true
router.get('/',validateToken, getNotifications);

// PATCH /api/notifications/:notificationId/read
router.patch('/:notificationId/read', markNotificationAsRead);

module.exports=router;