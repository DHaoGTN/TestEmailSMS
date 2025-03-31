const { google } = require("googleapis");
const { PubSub } = require("@google-cloud/pubsub");
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

    // Optionally, clear processed IDs periodically to prevent memory growth
    this.startProcessedIdCleanup();
  }

  startProcessedIdCleanup() {
    setInterval(() => {
      // Clear processed IDs every 24 hours
      this.processedMessageIds.clear();
      console.log('🧹 Processed message IDs cache cleared');
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
        userId: "suyama@gtn.co.jp",
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

      return res.data;
    } catch (error) {
      console.error(
        "❌ Error in watchInbox:",
        error.response ? error.response.data : error.message
      );
      throw error;
    }
  }

  listenToPubSub(subscriptionName, onEmailCallback) {
    const subscription = this.pubsub.subscription(subscriptionName);

    subscription.on('message', async (message) => {
      // console.log('📨 Received Pub/Sub message');
      message.ack();

      try {
        const messageData = Buffer.from(message.data, 'base64').toString('utf-8');
        const notification = JSON.parse(messageData);

        console.log('📨 Gmail push notification');
        console.log('  ➤ Email Address:', notification.emailAddress);
        console.log('  ➤ History ID:', notification.historyId);

        // Fetch recent messages
        const listResponse = await this.gmail.users.messages.list({
          userId: 'me',
          maxResults: 1,
          labelIds: ['INBOX'],
        });

        const messages = listResponse.data.messages || [];
        console.log('🧪 Total messages found:', messages.length);

        // Process recent messages
        for (const msg of messages) {
          // Check if message has already been processed
          if (this.processedMessageIds.has(msg.id)) {
            console.log(`🚫 Skipping already processed message: ${msg.id}`);
            continue;
          }

          try {
            const msgData = await this.gmail.users.messages.get({
              userId: 'me',
              id: msg.id,
              format: 'full',
            });

            // Add message ID to processed set
            this.processedMessageIds.add(msg.id);

            // Process and callback with email details
            this.processEmailMessage(msg.id, msgData, onEmailCallback);
          } catch (msgError) {
            console.error('❌ Error fetching individual message:', msgError.message);
          }
        }

        // Log processed message IDs for debugging
        console.log('🔍 Processed Message IDs:', Array.from(this.processedMessageIds));
      } catch (error) {
        console.error('❌ Error processing Pub/Sub message:', error);
      }
    });

    subscription.on('error', (err) => {
      console.error('❌ Pub/Sub listener error:', err.message);
    });

    console.log(`🎧 Pub/Sub subscription '${subscriptionName}' is listening for Gmail push events.`);
  }

  processEmailMessage(msgId, msgData, onEmailCallback) {
    const payload = msgData.data.payload;

    // Extract headers
    const headers = payload.headers.reduce((acc, h) => {
      acc[h.name.toLowerCase()] = h.value;
      return acc;
    }, {});

    const subject = headers["subject"] || "(No Subject)";
    const from = headers["from"] || "(No From)";
    const date = headers["date"] || "(No Date)";

    // Extract body
    let bodyData = payload.body?.data;
    if (!bodyData && payload.parts) {
      const plainPart = payload.parts.find((p) => p.mimeType === "text/plain");
      const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
      bodyData = plainPart?.body?.data || htmlPart?.body?.data;
    }

    const decodedBody = bodyData
      ? Buffer.from(bodyData, "base64").toString("utf-8")
      : "(No body found)";

    // console.log("📩 New email processed!");
    // console.log("  ➤ From:", from);
    // console.log("  ➤ Subject:", subject);
    // console.log("  ➤ Date:", date);

    // Call callback with email summary and full message data
    onEmailCallback(
      {
        msgId,
        subject,
        body: decodedBody,
        from,
        date,
        snippet: msgData.data.snippet,
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
}

module.exports = GmailReceiver;
