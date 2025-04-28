// gmailReceiver.js
const { google } = require("googleapis");
const { PubSub } = require("@google-cloud/pubsub");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

class GmailReceiver {
  constructor(serviceAccountPath) {
    this.pubsub = new PubSub({
      keyFilename: serviceAccountPath,
      projectId: process.env.PROJECT_ID,
    });

    this.gmail = google.gmail("v1");
    this.auth = null;

    // Add a Set to track processed message IDs
    this.processedMessageIds = new Set();

    // Path to store the latest historyId
    this.historyIdFilePath = path.join(__dirname, 'lastHistoryId.json');

    // Optionally, clear processed IDs periodically to prevent memory growth
    this.startProcessedIdCleanup();
  }

  startProcessedIdCleanup() {
    setInterval(() => {
      // Clear processed IDs every 24 hours
      this.processedMessageIds.clear();
      console.log("🧹 Processed message IDs cache cleared");
    }, 24 * 60 * 60 * 1000);
  }

  setAuth(oAuth2Client) {
    this.auth = oAuth2Client;
    this.gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  }

  async watchInbox() {
    if (!this.auth) throw new Error("OAuth2 client not set");

    try {
      const res = await this.gmail.users.watch({
        userId: "me",
        auth: this.auth,
        requestBody: {
          labelIds: ["INBOX"],
          topicName: process.env.TOPIC_NAME,
          labelFilterAction: "include",
        },
      });

      console.log("✅ Gmail watch started");
      console.log(
        "  ➤ Expiration:",
        new Date(Number(res.data.expiration)).toISOString()
      );
      console.log("  ➤ Initial historyId:", res.data.historyId);

      // Save the initial historyId for future recovery
      await this.saveHistoryId(res.data.historyId);

      return res.data;
    } catch (error) {
      console.error(
        "❌ Error in watchInbox:",
        error.response ? error.response.data : error.message
      );
      throw error;
    }
  }

  // Save the latest historyId to a file
  async saveHistoryId(historyId) {
    try {
      await fs.writeFile(
        this.historyIdFilePath,
        JSON.stringify({ historyId, timestamp: Date.now() })
      );
      console.log(`✅ Saved historyId: ${historyId}`);
    } catch (error) {
      console.error('❌ Failed to save historyId:', error);
    }
  }

  // Load the last saved historyId
  async getLastHistoryId() {
    try {
      const data = await fs.readFile(this.historyIdFilePath, 'utf8');
      const { historyId } = JSON.parse(data);
      return historyId;
    } catch (error) {
      console.error('❌ Failed to load historyId:', error);
      return null;
    }
  }

  listenToPubSub(subscriptionName, onEmailCallback) {
    const subscription = this.pubsub.subscription(subscriptionName);

    subscription.on("message", async (message) => {
      // console.log('📨 Received Pub/Sub message');
      message.ack();

      try {
        const messageData = Buffer.from(message.data, "base64").toString(
          "utf-8"
        );
        const notification = JSON.parse(messageData);

        console.log("📨 Gmail push notification");
        console.log("  ➤ Email Address:", notification.emailAddress);
        console.log("  ➤ History ID:", notification.historyId);

        // Save the latest historyId for recovery purposes
        await this.saveHistoryId(notification.historyId);

        // Fetch recent messages
        const listResponse = await this.gmail.users.messages.list({
          userId: "me",
          maxResults: 1,
          labelIds: ["INBOX"],
        });

        const messages = listResponse.data.messages || [];
        console.log("🧪 Total messages found:", messages.length);

        // Process recent messages
        for (const msg of messages) {
          // Check if message has already been processed
          if (this.processedMessageIds.has(msg.id)) {
            console.log(`🚫 Skipping already processed message: ${msg.id}`);
            continue;
          }

          try {
            const msgData = await this.gmail.users.messages.get({
              userId: "me",
              id: msg.id,
              format: "full",
            });

            // Add message ID to processed set
            this.processedMessageIds.add(msg.id);

            // Process and callback with email details
            this.processEmailMessage(msg.id, msgData, onEmailCallback);
          } catch (msgError) {
            console.error(
              "❌ Error fetching individual message:",
              msgError.message
            );
          }
        }

        // Log processed message IDs for debugging
        console.log(
          "🔍 Processed Message IDs:",
          Array.from(this.processedMessageIds)
        );
      } catch (error) {
        console.error("❌ Error processing Pub/Sub message:", error);
      }
    });

    subscription.on("error", (err) => {
      console.error("❌ Pub/Sub listener error:", err.message);
    });

    console.log(
      `🎧 Pub/Sub subscription '${subscriptionName}' is listening for Gmail push events.`
    );
  }

  async getAttachments(messageId, attachmentId) {
    try {
      const response = await this.gmail.users.messages.attachments.get({
        userId: "me",
        messageId: messageId,
        id: attachmentId,
      });
      return response.data.data;
    } catch (error) {
      console.error("❌ Error getting attachment:", error);
      throw error;
    }
  }

  async saveAttachment(attachmentData, filePath) {
    try {
      const buffer = Buffer.from(attachmentData, "base64");
      await require("fs").promises.writeFile(filePath, buffer);
      console.log(`✅ Attachment saved to ${filePath}`);
    } catch (error) {
      console.error("❌ Error saving attachment:", error);
      throw error;
    }
  }

  async processEmailMessage(msgId, msgData, onEmailCallback) {
    const payload = msgData.data.payload;

    // Extract headers
    const headers = payload.headers.reduce((acc, h) => {
      acc[h.name.toLowerCase()] = h.value;
      return acc;
    }, {});

    const subject = headers["subject"] || "(No Subject)";
    const from = headers["from"] || "(No From)";
    const date = headers["date"] || "(No Date)";

    // Extract HTML and plain text content
    let htmlContent = "";
    let plainTextContent = "";
    let attachments = [];

    const processPart = (part) => {
      if (part.mimeType === "text/html") {
        htmlContent = Buffer.from(part.body.data, "base64").toString("utf-8");
      } else if (part.mimeType === "text/plain") {
        plainTextContent = Buffer.from(part.body.data, "base64").toString(
          "utf-8"
        );
      } else if (part.body.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
        });
      }

      // Recursively process nested parts
      if (part.parts) {
        part.parts.forEach(processPart);
      }
    };

    // Process the main payload
    if (payload.body.data) {
      if (payload.mimeType === "text/html") {
        htmlContent = Buffer.from(payload.body.data, "base64").toString(
          "utf-8"
        );
      } else if (payload.mimeType === "text/plain") {
        plainTextContent = Buffer.from(payload.body.data, "base64").toString(
          "utf-8"
        );
      }
    }

    // Process all parts
    if (payload.parts) {
      payload.parts.forEach(processPart);
    }

    // Call callback with email summary and full message data
    onEmailCallback(
      {
        msgId,
        subject,
        htmlContent,
        plainTextContent,
        from,
        date,
        snippet: msgData.data.snippet,
        attachments,
      },
      msgData.data
    );
  }

  async getLatest() {
    // Get latest email, not realtime
    const list = await this.gmail.users.messages.list({
      userId: "me",
      maxResults: 1,
    });

    const msgId = list.data.messages?.[0]?.id;
    if (msgId) {
      const msg = await this.gmail.users.messages.get({
        userId: "me",
        id: msgId,
        format: "full", // 'full' returns headers + body + parts
      });

      const payload = msg.data.payload;

      // 🔹 Extract Headers
      const headers = payload.headers.reduce((acc, h) => {
        acc[h.name.toLowerCase()] = h.value;
        return acc;
      }, {});

      const subject = headers["subject"] || "(No Subject)";
      const from = headers["from"] || "(No From)";
      const date = headers["date"] || "(No Date)";

      // 🔹 Extract Plain Text or HTML Body
      let bodyData = payload.body?.data;

      if (!bodyData && payload.parts) {
        const plainPart = payload.parts.find(
          (p) => p.mimeType === "text/plain"
        );
        const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");

        bodyData = plainPart?.body?.data || htmlPart?.body?.data;
      }

      const decodedBody = bodyData
        ? Buffer.from(bodyData, "base64").toString("utf-8")
        : "(No body found)";

      // 🔹 Log Full Email
      console.log("📩 Full Email");
      console.log("  ➤ From:", from);
      console.log("  ➤ Subject:", subject);
      console.log("  ➤ Date:", date);
      console.log("  ➤ Body:\n", decodedBody);
    }
  }

  async recoverMissedEmails(onEmailCallback, maxResults = 10) {
    try {
      console.log("🔄 Starting email recovery process...");

      // Get the last saved historyId
      const lastHistoryId = await this.getLastHistoryId();

      if (!lastHistoryId) {
        console.log("⚠️ No previous historyId found. Cannot recover emails.");
        return { success: false, error: "No previous historyId found" };
      }

      console.log(`🔍 Recovering emails since historyId: ${lastHistoryId}`);

      // Get history since last known historyId
      const historyResponse = await this.gmail.users.history.list({
        userId: "me",
        startHistoryId: lastHistoryId,
        historyTypes: ["messageAdded"],
        maxResults: maxResults
      });

      console.log("✅ History retrieved successfully");

      if (!historyResponse.data.history || historyResponse.data.history.length === 0) {
        console.log("ℹ️ No new email history found since last check");
        return { success: true, emailsProcessed: 0 };
      }

      // Extract all message IDs from history
      const messageIds = new Set();
      historyResponse.data.history.forEach(history => {
        if (history.messagesAdded) {
          history.messagesAdded.forEach(msg => {
            if (msg.message && msg.message.id) {
              messageIds.add(msg.message.id);
            }
          });
        }
      });

      console.log(`🧪 Found ${messageIds.size} potentially missed emails`);

      // Process each missed email
      let processedCount = 0;
      for (const msgId of messageIds) {
        // Skip if already processed
        if (this.processedMessageIds.has(msgId)) {
          console.log(`🚫 Skipping already processed message: ${msgId}`);
          continue;
        }

        try {
          console.log(`📥 Fetching missed email: ${msgId}`);
          const msgData = await this.gmail.users.messages.get({
            userId: "me",
            id: msgId,
            format: "full"
          });

          // Add to processed set
          this.processedMessageIds.add(msgId);

          // Process the email
          this.processEmailMessage(msgId, msgData, onEmailCallback);
          processedCount++;
        } catch (error) {
          console.error(`❌ Error processing missed email ${msgId}:`, error.message);
        }
      }

      // Save the latest historyId for next time
      if (historyResponse.data.historyId) {
        await this.saveHistoryId(historyResponse.data.historyId);
      }

      console.log(`✅ Recovery complete. Processed ${processedCount} missed emails.`);
      return { 
        success: true, 
        emailsProcessed: processedCount,
        totalFound: messageIds.size
      };
    } catch (error) {
      console.error("❌ Error recovering missed emails:", error);
      return { 
        success: false, 
        error: error.message
      };
    }
  }
}

module.exports = GmailReceiver;
