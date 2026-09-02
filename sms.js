// sms.js — Africa's Talking SMS sender (reused unchanged from Kutana)
require("dotenv").config();
const axios = require("axios");
const https = require("https");

const hasCredentials = !!(process.env.AT_USERNAME && process.env.AT_API_KEY);

if (!hasCredentials) {
  console.warn(
    "[sms.js] No AT_USERNAME/AT_API_KEY found in .env — running in MOCK mode. " +
    "SMS sends will just be logged to the console, not actually sent."
  );
}

// Force TLS 1.2 on this specific agent — works around a TLS 1.3 handshake hang
// seen on some Windows machines talking to AT's AWS-hosted API. Scoped to just
// this agent so it doesn't affect anything else in the app.
const httpsAgent = new https.Agent({
  maxVersion: "TLSv1.2",
  minVersion: "TLSv1.2",
});

const AT_BASE_URL = "https://api.sandbox.africastalking.com/version1/messaging";

async function sendSms(phone, message) {
  if (!hasCredentials) {
    console.log(`[MOCK SMS] to ${phone}: ${message}`);
    return { mock: true, phone, message };
  }

  console.log("Sending SMS...");
  console.log("To:", phone);
  console.log("Message:", message);

  try {
    const response = await axios.post(
      AT_BASE_URL,
      new URLSearchParams({
        username: process.env.AT_USERNAME,
        to: phone,
        message: message,
      }).toString(),
      {
        httpsAgent,
        headers: {
          apiKey: process.env.AT_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        timeout: 15000,
      }
    );

    console.log("SMS Response:", JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (err) {
    console.error("[sms.js] Failed:", {
      message: err.message,
      code: err.code,
      data: err.response?.data,
    });
    throw err;
  }
}

async function broadcastSms(phones, message) {
  const results = [];
  for (const phone of phones) {
    results.push(await sendSms(phone, message));
  }
  return results;
}

module.exports = { sendSms, broadcastSms };
