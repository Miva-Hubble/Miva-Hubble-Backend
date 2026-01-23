# Miva Hubble Server

Backend API for Miva Hubble with Google OAuth authentication.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

3. Add your Google OAuth credentials to `.env`:
   - Get your Google Client ID from [Google Cloud Console](https://console.cloud.google.com/)
   - Make sure to configure authorized JavaScript origins and redirect URIs

## Development

```bash
npm run dev
```

Server runs on `http://localhost:7292`

## API Endpoints

### Authentication

**POST** `/api/auth/google`

Verify Google OAuth token from frontend.

Request body:

```json
{
  "credential": "google_id_token_from_frontend"
}
```

Response:

```json
{
  "success": true,
  "user": {
    "id": "google_user_id",
    "email": "user@example.com",
    "name": "User Name",
    "picture": "profile_picture_url",
    "emailVerified": true
  }
}
```

## Frontend Integration

This server works with [@react-oauth/google](https://www.npmjs.com/package/@react-oauth/google).

Frontend example:

```tsx
import { GoogleLogin } from "@react-oauth/google";

<GoogleLogin
  onSuccess={async (credentialResponse) => {
    const response = await fetch("http://localhost:7292/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: credentialResponse.credential }),
    });
    const data = await response.json();
    console.log(data.user);
  }}
  onError={() => console.log("Login Failed")}
/>;
```
