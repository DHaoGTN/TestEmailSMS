// gmailSender.js
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
require("dotenv").config();

class GmailSender {
  constructor() {
    this.oAuth2Client = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      process.env.REDIRECT_URI
    );
    this.oAuth2Client.setCredentials({
      refresh_token: process.env.REFRESH_TOKEN,
    });
  }

  async sendEmail({ to, subject, text }) {
    const accessToken = await this.oAuth2Client.getAccessToken();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: process.env.EMAIL,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        refreshToken: process.env.REFRESH_TOKEN,
        accessToken: accessToken.token,
      },
    });

    const mailOptions = {
      from: `Gmail Demo <${process.env.EMAIL}>`,
      to,
      subject,
      text,
    };

    return transporter.sendMail(mailOptions);
  }
}

module.exports = GmailSender;
