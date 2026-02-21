const mongoose = require('mongoose');

// Optional: reduce noisy index builds in prod
if (process.env.NODE_ENV === 'production') {
    mongoose.set('autoIndex', false);
}

const redactMongoUri = (uri) => {
    try {
        const u = new URL(uri);
        // redact username:password if present
        if (u.username || u.password) {
            u.username = '***';
            u.password = '***';
        }
        return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
    } catch (_) {
        return '<invalid MONGO_URI>';
    }
};

const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGO_URI is not defined in environment variables');
        }

        const redacted = redactMongoUri(mongoUri);
        console.log(`[Mongo] Connecting to: ${redacted}`);

        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 10000, // 10s timeout for clearer errors
            retryWrites: true,
            w: 'majority',
            appName: 'chat-crm-backend',
        });

        console.log('MongoDB connected');
    } catch (err) {
        console.error('[Mongo] Error connecting to MongoDB:', err.message);
        console.error('[Mongo] Hint: Verify MONGO_URI host matches your Atlas connection string and your IP is whitelisted.');
        // Fail fast so process managers (e.g., nodemon) can restart
        process.exit(1);
    }
};

module.exports = connectDB;