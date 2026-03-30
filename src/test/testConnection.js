require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ==== MongoDB Test ====
async function testMongo() {
  console.log("🔍 Testing MongoDB connection...");
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000 // 10 seconds timeout
    });
    console.log("✅ MongoDB connected successfully");
    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
  }
}

// ==== SMTP Test ====
async function testSMTP() {
  console.log("\n🔍 Testing SMTP connection...");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // SSL
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_PASS
    },
    connectionTimeout: 10000 // 10 seconds
  });

  try {
    await transporter.verify();
    console.log("✅ SMTP connected successfully");
  } catch (error) {
    console.error("❌ SMTP connection error:", error.message);
  }
}

// ==== Run Both Tests ====
(async () => {
  await testMongo();
  await testSMTP();
})();
