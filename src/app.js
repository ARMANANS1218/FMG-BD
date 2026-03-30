require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const hpp = require("hpp");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const connectDB = require("./config/connect");
const Room = require("./models/Room");

// --- ROUTES ---
const superadminRoutes = require("./routes/superadmin.routes"); // NEW: SuperAdmin routes
const messageRoutes = require("./routes/message.routes");
const userRoutes = require("./routes/user.routes");
const ticketRoutes = require("./routes/ticket.routes");
const notificationRoutes = require("./routes/notification.routes");
const webhookRoutes = require("./routes/webhook.route");
const chatmessageRoutes = require("./routes/chatmessage.routes");
const emailRoutes = require("./routes/email.routes");
const customerRoutes = require("./routes/customer.routes");
const queryRoutes = require("./routes/query.routes");
const snapshotRoutes = require("./routes/snapshot.routes");
const newChatRoutes = require("./routes/new.chat.routes");
const roomRoutes = require("./routes/room.routes");
const screenshotRoutes = require("./routes/screenshot.routes");
const webrtcRoutes = require("./routes/webrtc.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const qaRoutes = require("./routes/qa.routes");
const geocamRoutes = require("./routes/geocam.routes");
const locationAccessRoutes = require("./routes/locationAccess.routes");
const faqRoutes = require("./routes/faq.routes");
const trainingMaterialRoutes = require("./routes/trainingMaterial.routes");
const shiftRoutes = require("./routes/shift.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const holidayRoutes = require("./routes/holiday.routes");
const leaveRoutes = require("./routes/leave.routes");
const forgotPasswordRoutes = require("./routes/forgotPassword.routes");
const agentPerformanceRoutes = require("./routes/agentPerformance.routes");
const planRoutes = require("./routes/plan.routes");
const Staff = require("./models/Staff");
const User = require("./models/User");
const initCallSocket = require("./sockets/callSocket");
const initQuerySocket = require("./socket/querySocket");
const initEmailSocket = require("./socket/emailSocket");
const initTicketSocket = require("./socket/ticketNamespace");
const { initLoginTimingAutoLogout, setupLoginTimingSocketHandler } = require("./socket/loginTimingSocket");
// Email Ticketing module (modular, independent)
const emailTicketingRoutes = require("./email-ticketing/ticket.routes");
const { startEmailTicketing } = require("./email-ticketing/imap/imapListener");
const { startAllFromDB } = require("./email-ticketing/imap/multiTenant");

// --- INIT APP ---
const app = express();
const server = http.createServer(app);

// ✅ Allowed Origins (merge static + env + localhost variants)
const localHosts = [5173,5174,5000].flatMap(p => [
  `http://localhost:${p}`,
  `http://127.0.0.1:${p}`
]);
const prodHosts = [
  "https://chat-crm-backend-7mzo.onrender.com",
  "https://chatcrm.playzelo.cloud",
  "https://live-chat-crm.vercel.app",
  "https://www.bitmaxtechnology.com",
  "https://shyeyes-backend.onrender.com",
  "https://shyeyes.com",
  "https://shyeyes-b.onrender.com",
  "https://shyeyes-frontend.vercel.app",
  "https://crm-wdget-shyeyes-fd.vercel.app",
  "https://btclienterminal.com",
  "http://btclienterminal.com",
  "https://btclienterminal.com/FMG",
  "http://btclienterminal.com/FMG/",
  "https://btclienterminal.com",
  "https://www.btclienterminal.com",
  "https://chatnexusterminal.uk",
  
];
const pathVariants = (base) => [base, base + '/', base + '/FMG', base + '/FMG/', base + '/118029/TX', base + '/118029/TX'];
const shyeyesVariants = (base) => [base, base + '/', base + '/shyeyes', base + '/shyeyes/'];

const allowedOrigins = [
  ...localHosts.flatMap(pathVariants),
  ...localHosts.flatMap(shyeyesVariants),
  ...prodHosts.flatMap(pathVariants),
  ...prodHosts.flatMap(shyeyesVariants),
  process.env.FRONTEND_URL
].filter(Boolean);

// Allow all Vercel preview/production subdomains
const vercelPreviewRegex = /^https:\/\/.+\.vercel\.app$/i;

// ✅ Common CORS check
const checkOrigin = (origin, callback) => {
  if (!origin) return callback(null, true); // allow non-browser clients
  if (allowedOrigins.includes(origin) || vercelPreviewRegex.test(origin)) return callback(null, true);
  return callback(new Error("Not allowed by CORS: " + origin));
};



// ✅ CORS preflight handler — MUST run before helmet and everything else
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isAllowed = !origin || allowedOrigins.includes(origin) || vercelPreviewRegex.test(origin);
  if (isAllowed && origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-organization-id, X-Organization-Id, x-api-key, X-Api-Key, X-Requested-With, Accept, Origin, Cache-Control, Pragma"
    );
  }
  // Fast-path preflight — return immediately, skip helmet/body-parsers
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ✅ Middlewares
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
  })
);
app.use(hpp());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(
  cors({
    origin: checkOrigin,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-organization-id",
      "X-Organization-Id",
      "x-api-key",
      "X-Api-Key",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control",
      "Pragma"
    ],
    optionsSuccessStatus: 204,
  })
);

// ✅ Static File Serving (Uploads)
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(path.join(__dirname, "uploads"))
);

// Serve call screenshots specifically
app.use(
  "/uploads/call-screenshots",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(path.join(__dirname, "uploads/call-screenshots"))
);

// ✅ DB Connect
connectDB();

// Maps
const connectedUsers = new Map();

// Socket.io
const io = new Server(server, {
  cors: { origin: checkOrigin, methods: ["GET", "POST"], credentials: true },
});

// 🔐 Socket Auth (JWT)
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next();
    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    socket.userId = payload?.id?.toString();
    if (!socket.userId) return next();

    // Optional: attach some user props
    // Staff-first lookup (all non-customer roles), fallback to User (Customer)
    let user = await Staff.findById(socket.userId).select("-password");
    if (!user) {
      user = await User.findById(socket.userId).select("-password");
    }
    socket.user_name = user?.user_name;
    socket.name = user?.name;
    next();
  } catch (err) {
    console.error("Socket auth error:", err.message);
    next();
  }
});

// 🧩 Attach the call socket layer
initCallSocket(io, connectedUsers);

// 🧩 Attach the query socket layer
initQuerySocket(io);

// 🧩 Attach the email socket layer
initEmailSocket(io);

// 🧩 Attach the ticket socket layer
const ticketNamespace = initTicketSocket(io);
app.set('ticketNamespace', ticketNamespace);

// 🧩 Attach the login timing socket layer (auto-logout at end time)
initLoginTimingAutoLogout(io);
setupLoginTimingSocketHandler(io);

// 🧩 Widget namespace for guest conversations
const widgetNamespace = io.of('/widget');
widgetNamespace.on('connection', (socket) => {
  console.log(`📱 Widget connected: ${socket.id}`);
  
  const { conversationId, petitionId, apiKey } = socket.handshake.query;
  console.log(`📱 Widget params:`, { conversationId, petitionId, apiKey: apiKey?.substring(0, 10) + '...' });
  
  if (conversationId) {
    socket.join(conversationId);
    console.log(`✅ Widget ${socket.id} joined conversation: ${conversationId}`);
  }
  
  if (petitionId) {
    socket.join(petitionId);
    console.log(`✅ Widget ${socket.id} joined petition: ${petitionId}`);
  }
  
  // Log all rooms this socket is in
  console.log(`📍 Widget ${socket.id} is in rooms:`, Array.from(socket.rooms));
  
  // Handle widget messages
  socket.on('widget-message', async (data) => {
    try {
      const { conversationId, petitionId, message, senderName, senderType } = data;
      console.log(`📨 Widget message:`, { conversationId, petitionId, message: message?.substring(0, 50) });
      
      // Find the query and add message
      const Query = require('./models/Query');
      const query = await Query.findOne({ petitionId });
      
      if (query) {
        const newMessage = {
          sender: null, // Guest user has no User ID
          senderName: senderName || 'Guest User',
          senderRole: senderType || 'Customer',
          message,
          timestamp: new Date(),
          isRead: false
        };
        
        query.messages.push(newMessage);
        query.lastActivityAt = new Date();
        await query.save();
        
        // Get the saved message with _id
        const savedQuery = await Query.findOne({ petitionId });
        const savedMessage = savedQuery.messages[savedQuery.messages.length - 1];
        
        // DON'T broadcast back to widget - avoid duplicate messages
        // Only broadcast to OTHER clients, not the sender
        socket.to(conversationId).emit('new-message', {
          conversationId,
          petitionId,
          message,
          senderName,
          senderType,
          timestamp: new Date()
        });
        
        // Also emit to query namespace for agents with proper format
        const queryNamespace = io.of('/query');
        const querySockets = await queryNamespace.in(petitionId).fetchSockets();
        console.log(`🔍 Query sockets in room ${petitionId}:`, querySockets.length);
        
        queryNamespace.to(petitionId).emit('new-query-message', {
          petitionId,
          message: {
            _id: savedMessage._id,
            sender: savedMessage.sender,
            senderName: savedMessage.senderName,
            senderRole: savedMessage.senderRole,
            message: savedMessage.message,
            timestamp: savedMessage.timestamp
          },
          queryStatus: savedQuery.status
        });
        
        console.log(`✅ Widget message saved and broadcasted to ${querySockets.length} agents`);
      }
    } catch (error) {
      console.error('❌ Widget message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  // Handle customer typing indicator from widget
  socket.on('customer-typing', async ({ petitionId, userName, isTyping }) => {
    try {
      console.log(`⌨️ Customer typing:`, { petitionId, userName, isTyping });
      
      // Relay to agents in query namespace
      const queryNamespace = io.of('/query');
      queryNamespace.to(petitionId).emit('user-typing', {
        petitionId,
        userId: 'widget-customer',
        userName: userName || 'Customer',
        isTyping
      });
    } catch (error) {
      console.error('❌ Customer typing error:', error);
    }
  });
  
  // Handle feedback submission from widget
  socket.on('submit-feedback', async ({ petitionId, rating, comment }) => {
    try {
      console.log('📝 Widget feedback submission:', { petitionId, rating, comment });
      
      const Query = require('./models/Query');
      const query = await Query.findOne({ petitionId });
      
      if (!query) {
        return socket.emit('error', { message: 'Query not found' });
      }
      
      if (query.status !== 'Resolved') {
        return socket.emit('error', { message: 'Can only provide feedback for resolved queries' });
      }
      
      // Validate rating
      if (!rating || rating < 1 || rating > 5) {
        return socket.emit('error', { message: 'Rating must be between 1 and 5' });
      }
      
      // Update query with feedback
      query.feedback = {
        rating: rating,
        comment: comment || '',
        submittedAt: new Date()
      };
      await query.save();
      
      console.log('✅ Widget feedback saved for petition:', petitionId);
      
      // Notify agents in the query namespace
      const queryNamespace = io.of('/query');
      queryNamespace.to(petitionId).emit('feedback-received', {
        petitionId,
        rating,
        comment,
        timestamp: new Date()
      });
      
      // Also broadcast to organization room for query list updates
      if (query.organizationId) {
        const orgRoom = `org:${query.organizationId}`;
        queryNamespace.to(orgRoom).emit('feedback-received', {
          petitionId,
          rating,
          comment,
          timestamp: new Date()
        });
        console.log(`📡 Feedback notification sent to org room: ${orgRoom}`);
      }
      
      // Confirm to widget customer
      socket.emit('feedback-submitted', {
        petitionId,
        success: true
      });
      
    } catch (error) {
      console.error('❌ Widget feedback submission error:', error);
      socket.emit('error', { message: 'Failed to submit feedback' });
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`📱 Widget disconnected: ${socket.id}`);
  });
});

// Make io accessible to routes (after io is initialized)
app.set('io', io);

// ✅ API Routes
app.use("/api/v1/superadmin", superadminRoutes); // NEW: SuperAdmin routes (no tenant middleware)
app.use("/api/v1/chat", messageRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/tickets", ticketRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/webhook", webhookRoutes);
app.use("/api/v1/email", emailRoutes);
app.use("/api/v1/chatmessage", chatmessageRoutes);
app.use("/api/v1/customer", customerRoutes);
app.use("/api/v1/query", queryRoutes);
app.use("/api/v1/snapshot", snapshotRoutes);
app.use("/api/v1/newchat", newChatRoutes);
app.use("/api/v1/room", roomRoutes);
app.use("/api/v1/screenshot", screenshotRoutes);
app.use("/api/v1/webrtc", webrtcRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/organization-ip-config", require("./routes/organizationIpConfig.routes"));
app.use("/api/v1/qa", qaRoutes);
app.use("/api/v1/geocam", geocamRoutes);
app.use("/api/v1/location", locationAccessRoutes);
app.use("/api/v1/faq", faqRoutes);
app.use("/api/v1/roles", require("./routes/role.routes"));
app.use("/api/v1/training-material", trainingMaterialRoutes);
app.use("/api/v1/shift", shiftRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/holiday", holidayRoutes);
app.use("/api/v1/leave", leaveRoutes);
app.use("/api/v1/email-ticketing", emailTicketingRoutes);
app.use("/api/v1/admin", require("./routes/admin.routes"));
app.use("/api/v1/agent-performance", agentPerformanceRoutes);
app.use("/api/v1/forgot-password", forgotPasswordRoutes);
app.use("/api/v1/invoices", require("./routes/invoice.routes"));
app.use("/api/v1/plans", planRoutes);

// ✅ Health Check
app.get("/", (req, res) => {
  res.json({ message: "✅ Secure Express API is running" });
});

app.set("trust proxy", true);

// ✅ Global error handler — always include CORS headers so browsers can read error responses
app.use((err, req, res, next) => {
  const origin = req.headers.origin;
  const isAllowed = !origin || allowedOrigins.includes(origin) || vercelPreviewRegex.test(origin);
  if (isAllowed && origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  console.error("Unhandled error:", err.message || err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ message: err.message || "Internal Server Error" });
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server listening at http://localhost:${PORT}`)
);

// Optionally start IMAP listener for email ticketing when env is enabled
try {
  // Start multi-tenant listeners first
  startAllFromDB()
    .then(async () => {
      // After attempting multi-tenant start, decide on single-tenant fallback
      if ((process.env.EMAIL_TICKETING_ENABLED || 'true') === 'true') {
        const OrgEmailConfig = require('./email-ticketing/models/OrgEmailConfig');
        try {
          const cfgCount = await OrgEmailConfig.countDocuments({ isEnabled: true });
          if (cfgCount === 0) {
            console.log('[EmailTicketing] No enabled org configs found. Starting env single-tenant listener.');
            startEmailTicketing();
          } else {
            console.log('[EmailTicketing] Skipping env single-tenant listener; multi-tenant configs present:', cfgCount);
          }
        } catch (e) {
          console.error('[EmailTicketing] Count error, falling back to env single-tenant start:', e.message);
          startEmailTicketing();
        }
      }
    })
    .catch((e) => console.error('Multi-tenant start error:', e?.message));
} catch (err) {
  console.error('Failed to start Email Ticketing IMAP listener:', err?.message);
}
