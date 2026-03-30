require('dotenv').config();
const axios = require('axios');

const sendMessage = async (to, message) => {
  const petitionToken = generatePetition(); // generate token

  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message }
  };

  try {
    const res = await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Message sent:', res.data);

    return {
      success: true,
      petitionToken,
      response: res.data
    };
  } catch (err) {
    console.error('❌ Failed to send message:', err.response?.data || err.message);
    return {
      success: false,
      petitionToken,
      error: err.response?.data || err.message
    };
  }
};

module.exports = { sendMessage };
