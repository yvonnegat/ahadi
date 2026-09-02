require("dotenv").config();
const express = require("express");
const cors = require("cors");

const apiRoutes = require("./api");
const ussdRoutes = require("./ussd");
const smsInboundRoutes = require("./smsInbound");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Africa's Talking posts form-encoded data

app.use("/api", apiRoutes);
app.use("/ussd", ussdRoutes);               // Set this as your USSD callback URL in the AT dashboard
app.use("/sms/incoming", smsInboundRoutes); // Set this as your SMS "incoming messages" callback URL

// Frontend + backend in one process: the web register (public/) is served
// straight off this same Express server and talks to /api over fetch —
// no separate frontend app, build step, or port to manage.
app.use(express.static("."));
// Multer (photo upload on reports) throws before it ever reaches the route
// handler's try/catch, so it needs its own error middleware or a bad photo
// upload would otherwise crash the request with an unhandled 500 HTML page.
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    return res.status(400).json({ error: `Photo upload failed: ${err.message}` });
  }
  if (err) {
    console.error("[server.js] unhandled error:", err.message);
    return res.status(500).json({ error: err.message || "Something went wrong." });
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ahadi backend listening on http://localhost:${PORT}`);
  console.log(`USSD callback:         http://localhost:${PORT}/ussd`);
  console.log(`SMS incoming callback: http://localhost:${PORT}/sms/incoming`);
});