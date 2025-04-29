// index.js
const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const { google } = require("googleapis");

const GmailSender = require("./gmailSender");
const GmailReceiver = require("./gmailReceiver");
const TwilioService = require("./twilioService");

dotenv.config();
const app = express();
app.use(express.json());

// Setup GmailSender
const sender = new GmailSender();

// Setup GmailReceiver
const serviceAccountPath = path.join(
  __dirname,
  "test-email-hao-gmail-pubsub.json"
);
const receiver = new GmailReceiver(serviceAccountPath);

const twilioService = new TwilioService();

// Setup OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
receiver.setAuth(oauth2Client);

const PORT = process.env.PORT || 3000;

// ✅ KEEP: Send email API
app.post("/send", async (req, res) => {
  try {
    const result = await sender.sendEmail(req.body);
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

// Watch for new emails API
app.get("/watch", async (req, res) => {
  try {
    await receiver.watchInbox();
    receiver.listenToPubSub(
      process.env.SUBSCRIPTION_NAME,
      async (emailData, rawData) => {
        console.log("📩 New email received!");
        console.log("  ➤ From:", emailData.from);
        console.log("  ➤ Subject:", emailData.subject);
        console.log("  ➤ Body:", emailData.body);
        console.log("  ➤ Date:", emailData.date);
        console.log("  ➤ Message ID:", emailData.msgId);
        console.log("HTML Content:", emailData.htmlContent);
        console.log("Plain Text Content:", emailData.plainTextContent);

        // Handle attachments
        if (emailData.attachments.length > 0) {
          for (const attachment of emailData.attachments) {
            // Get the attachment data
            const attachmentData = await receiver.getAttachments(
              emailData.msgId,
              attachment.id
            );

            // Save it to a local file
            const localPath = `./data/${attachment.filename}`;
            await receiver.saveAttachment(attachmentData, localPath);
          }
        }
      }
    );

    res.send("✅ Gmail push watch started and Pub/Sub listener running!");
  } catch (err) {
    console.error("❌ /watch failed:", err);
    res.status(500).send(`Failed to start watch: ${err.message}`);
  }
});

// Watch for latest emails API
app.get("/latest", async (req, res) => {
  try {
    await receiver.getLatest();
    res.send("✅ Get latest email inbox!");
  } catch (err) {
    console.error("❌ /watch failed:", err);
    res.status(500).send(`Failed to start watch: ${err.message}`);
  }
});

/**
 * Recover missed emails 24 hours ago
 */
app.get("/recover-emails", async (req, res) => {
  try {
    // Optional query parameter for maximum number of emails to recover
    const maxResults = req.query.max ? parseInt(req.query.max) : 20;

    const result = await receiver.recoverMissedEmails(
      async (emailData, rawData) => {
        console.log("📩 Recovered missed email!");
        console.log("  ➤ From:", emailData.from);
        console.log("  ➤ Subject:", emailData.subject);
        console.log("  ➤ Body:", emailData.plainTextContent);
        console.log("  ➤ Date:", emailData.date);
        console.log("  ➤ Message ID:", emailData.msgId);

        // Handle attachments for recovered emails too
        if (emailData.attachments && emailData.attachments.length > 0) {
          for (const attachment of emailData.attachments) {
            const attachmentData = await receiver.getAttachments(
              emailData.msgId,
              attachment.id
            );

            const localPath = `./data/${attachment.filename}`;
            await receiver.saveAttachment(attachmentData, localPath);
          }
        }

        // You could add additional processing here
        // For example, sending notifications that a missed email was recovered
      },
      maxResults
    );

    res.status(200).json({
      message: "Email recovery process completed",
      result
    });
  } catch (err) {
    console.error("❌ Email recovery failed:", err);
    res.status(500).send(`Failed to recover missed emails: ${err.message}`);
  }
});


// Twilio: Send SMS API
app.post("/send-sms", async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res
        .status(400)
        .json({ error: "Phone number and message are required" });
    }

    const result = await twilioService.sendSMS(to, message);
    res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    console.error("❌ Failed to send SMS:", err);
    res.status(500).send(`Failed to send SMS: ${err.message}`);
  }
});

// Twilio: Send bulk SMS API
app.post("/send-bulk-sms", async (req, res) => {
  try {
    const { recipients, message } = req.body;

    if (
      !recipients ||
      !Array.isArray(recipients) ||
      recipients.length === 0 ||
      !message
    ) {
      return res
        .status(400)
        .json({ error: "Valid recipients array and message are required" });
    }

    const results = await twilioService.sendBulkSMS(recipients, message);
    res.status(200).json({ results });
  } catch (err) {
    console.error("❌ Failed to send bulk SMS:", err);
    res.status(500).send(`Failed to send bulk SMS: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
