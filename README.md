# Miva Hubble Backend

Backend API for Miva Hubble with authentication, user management, and OTP verification.

## Tech Stack

- **Node.js** with **Express** and **TypeScript**
- **PostgreSQL** database with **Prisma ORM**
- **Docker** for local database setup
- **Google OAuth 2.0** authentication
- **Nodemailer** for email services
- **Zod** for request validation

## Features

- Google OAuth authentication
- Email/password authentication with OTP verification
- User management
- JWT token-based sessions
- Email verification system
- Password reset functionality

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Database Setup

Start PostgreSQL using Docker:

```bash
docker-compose up -d
```

This creates a PostgreSQL database on port `6489` with:

- Database: `miva_hubble`
- User: `postgres`
- Password: `postgres`

### 3. Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Configure the following variables:

```env
PORT=7292
CLIENT_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your_google_client_id_here
DATABASE_URL=postgresql://postgres:postgres@localhost:6489/miva_hubble

# Email Configuration (for OTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

Get your Google Client ID from [Google Cloud Console](https://console.cloud.google.com/)

### 4. Database Migration

Run Prisma migrations:

```bash
npx prisma migrate dev
```

Generate Prisma client:

```bash
npx prisma generate
```

## Development

Start the development server:

```bash
npm run dev
```

Server runs on `http://localhost:7292`

## Production

Build and start:

```bash
npm run build
npm start
```

## Database Schema

### User Model

- Email/username authentication
- Google OAuth integration
- Email verification status
- Login provider tracking
- Profile information

### OTP Model

- Email verification codes
- Password reset codes
- Expiration handling
- One-time use enforcement

## API Endpoints

### Authentication

#### Google OAuth Login

**POST** `/api/auth/google`

```json
{
  "credential": "google_id_token"
}
```

#### Register

**POST** `/api/auth/register`

```json
{
  "email": "user@example.com",
  "username": "username",
  "name": "Full Name",
  "password": "password123"
}
```

#### Login

**POST** `/api/auth/login`

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Verify Email

**POST** `/api/auth/verify-email`

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

#### Request Password Reset

**POST** `/api/auth/forgot-password`

```json
{
  "email": "user@example.com"
}
```

#### Reset Password

**POST** `/api/auth/reset-password`

```json
{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "newpassword123"
}
```

### Users

#### Get All Users

**GET** `/api/users`

## Frontend Integration

Works with [@react-oauth/google](https://www.npmjs.com/package/@react-oauth/google):

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
    console.log(data);
  }}
  onError={() => console.log("Login Failed")}
/>;
```

## Project Structure

```
src/
├── controller/       # Request handlers
├── routes/          # API route definitions
├── services/        # Business logic
├── middleware/      # Request validation
├── schemas/         # Zod validation schemas
├── lib/            # Database client
└── utils/          # Helper functions
```

## License

MIT
