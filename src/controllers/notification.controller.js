const Notification = require("../models/Notification");


exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, page = 1, unreadOnly = false } = req.query;

    const filter = {
      receivers: {
        $elemMatch: {
          userId,
          ...(unreadOnly === 'true' && { isRead: false })
        }
      }
    };

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .select('message link createdAt updatedAt ticketId receivers'),
      
      Notification.countDocuments(filter)
    ]);

    // Extract read status for the user from receivers array
    const formatted = notifications.map(n => {
      const receiver = n.receivers.find(r => r.userId.toString() === userId);
      return {
        _id: n._id,
        message: n.message,
        link: n.link,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        ticketId: n.ticketId,
        isRead: receiver?.isRead || false,
        readAt: receiver?.readAt || null
      };
    });

    res.status(200).json({
      success: true,
      message: 'Notifications fetched successfully',
      data: {
        notifications: formatted,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
    });
  }
};

exports.markNotificationAsRead = async (req, res) => {
  const userId = req.user._id; // Using _id instead of id for consistency
  const { notificationId } = req.params;

  try {
    // Validate notification ID format
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid notification ID format' 
      });
    }

    // Update with timestamp and return the updated document
    const result = await Notification.findOneAndUpdate(
      { 
        _id: notificationId, 
        'receivers.userId': userId 
      },
      { 
        $set: { 
          'receivers.$.isRead': true,
          'receivers.$.readAt': new Date() 
        } 
      },
      { 
        new: true, // Return the updated document
        projection: { // Only return necessary fields
          'receivers.$': 1,
          message: 1,
          link: 1,
          createdAt: 1
        }
      }
    );

    if (!result) {
      return res.status(404).json({ 
        success: false, 
        message: 'Notification not found or already marked as read' 
      });
    }

    // Get the updated receiver status
    const updatedReceiver = result.receivers.find(r => r.userId.equals(userId));

    // Emit real-time update via Socket.io if configured
    if (req.io) {
      req.io.to(`user_${userId}`).emit('notification_read', {
        notificationId,
        readAt: updatedReceiver.readAt
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Notification marked as read',
      data: {
        notificationId,
        isRead: true,
        readAt: updatedReceiver.readAt,
        message: result.message,
        link: result.link
      }
    });

  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update notification status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
