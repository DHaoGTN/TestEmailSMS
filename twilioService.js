// twilioService.js
const twilio = require('twilio');
require('dotenv').config();

class TwilioService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  async sendSMS(to, message) {
    try {
      const result = await this.client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: to
      });
      console.log(`📱 SMS sent successfully! SID: ${result.sid}`);
      return { success: true, sid: result.sid };
    } catch (error) {
      console.error(`❌ Failed to send SMS: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async sendBulkSMS(recipients, message) {
    if (!Array.isArray(recipients)) {
      throw new Error('Recipients must be an array of phone numbers');
    }

    const results = [];
    for (const recipient of recipients) {
      const result = await this.sendSMS(recipient, message);
      results.push({ to: recipient, ...result });
    }

    return results;
  }
}

module.exports = TwilioService;