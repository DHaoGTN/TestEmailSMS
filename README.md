### SETUP

#### 1. Setup Auth

- Because this is demo, we just get refresh token directly to use GCP service, no need OAuth screen setup:

1.1. Create OAuth client ID:
  + GCP > API&Services > Credentials > Create OAuth client ID > Create... > Authorized redirect URIs:
  add https://developers.google.com/oauthplayground
  + On Consent screen > Data access: add scope permission:
  https://www.googleapis.com/auth/gmail.modify,
  https://www.googleapis.com/auth/gmail.send,
  https://www.googleapis.com/auth/gmail.readonly,
  https://mail.google.com/

1.2. Get token directly:
  + Go: https://developers.google.com/oauthplayground
  + Open Settings ⚙️ (top right corner)
Check the following:
Use your own OAuth credentials → Checked
Fill in:
    + OAuth Client ID → your-client-id.apps.googleusercontent.com
    + Client Secret → your-client-secret
These come from your OAuth 2.0 Client Credentials in the above step
  + On Step 1: Select and Authorize Scopes
Paste and select this Gmail scope:
https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.readonly,https://mail.google.com/
Then click Authorize APIs.
After clicking Authorize, you’ll be redirected and an authorization code will appear.
  + On Step 2: Exchange Authorization Code for Tokens.
  Click Exchange authorization code for tokens. You'll now get token

#### 2. Setup for get realtime watch email receive

2.1. GCP > Enable Gmail API

2.2. GCP > Pub/sub:
  + Go to Pub/Sub Topic and create Topic (check Add default subscription)
  + After created, go to that topic > Tab permission > Add pricinple:
    + Principal: gmail-api-push@system.gserviceaccount.com
    + Role: Pub/Sub Publisher
  + Make sure created subscription is type Pull

2.3. Create Service account (for listener) with role: Pub/Sub Subscriber, then download JSON key and put to project.
