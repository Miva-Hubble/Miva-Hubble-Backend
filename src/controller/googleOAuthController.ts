import { Request, Response } from "express";
import { google } from "googleapis";
import { AuthService } from "../services/authService.js";
import prisma from "../lib/prisma.js";
import { HttpStatus } from "../utils/httpStatus.js";
import { isMivaEmail } from "../schemas/auth.schema.js";
import { upsertGoogleUser } from "../services/userService.js";

// Initialize OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:7292/api/auth/google/callback",
);

/**
 * GET /api/auth/google
 * Initiates the OAuth flow by redirecting to Google's consent screen
 */
export const initiateGoogleAuth = (req: Request, res: Response) => {
  try {
    // Generate the authorization URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline", // Get refresh token
      scope: [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      prompt: "consent", // Force consent screen to get refresh token
    });

    // Return the URL for frontend to redirect, or redirect directly
    res.json({
      success: true,
      authUrl,
      message: "Redirect user to this URL",
      hd: "miva.edu.ng",
    });

  } catch (error) {
    console.error("Google auth initiation error:", error);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to initiate Google authentication" });
  }
};

/**
 * GET /api/auth/google/callback
 * Handles the OAuth callback from Google
 * This is where Google redirects after user grants permission
 */
export const handleGoogleCallback = async (req: Request, res: Response) => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Authorization code is required" });
    }

    // ✅ STEP 1: Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // ✅ STEP 2: GET USER INFO (THIS FIXES YOUR ERROR)
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });

    const { data: userInfo } = await oauth2.userinfo.get();

    // 🚨 THIS LINE MUST EXIST — this is what defines userInfo

    if (!userInfo.email) {
      return res.status(400).json({ error: "Failed to get user email" });
    }

    // ✅ STEP 3: DOMAIN CHECK
    if (!userInfo.email.endsWith("@miva.edu.ng")) {
      return res.status(403).json({
        error: "Only Miva emails allowed",
      });
    }

    // ✅ STEP 4: UPSERT USER (NEW SERVICE)
    
    const user = await upsertGoogleUser(userInfo);

    // ✅ STEP 5: GENERATE TOKENS
    const { accessToken, refreshToken } = AuthService.generateTokens(
      user.id,
      user.email,
    );

    // ✅ STEP 6: SET COOKIES
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // ✅ STEP 7: REDIRECT
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    return res.redirect(`${frontendUrl}/auth/callback?success=true`);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Authentication failed" });
  }
};

/**
 * POST /api/auth/google/token
 * Alternative endpoint: Exchange authorization code for tokens manually
 * Use this if you want to handle the callback on frontend and send code to backend
 */
export const exchangeGoogleCode = async (req: Request, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Authorization code is required",
      });
    }

    // ✅ STEP 1: Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // ✅ STEP 2: Get user info
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // ✅ STEP 3: Validate email
    if (!userInfo?.email) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Failed to get user email from Google",
      });
    }

    // ✅ STEP 4: Domain check
    if (!isMivaEmail(userInfo.email)) {
      return res.status(HttpStatus.FORBIDDEN).json({
        error: "Only Miva student emails (@miva.edu.ng) are allowed",
      });
    }

    // ✅ STEP 5: UPSERT USER (REPLACES ALL OLD LOGIC)
    const user = await upsertGoogleUser(userInfo);

    // ✅ STEP 6: Generate tokens
    const { accessToken, refreshToken } = AuthService.generateTokens(
      user.id,
      user.email,
    );

    // ✅ STEP 7: Return response
    return res.status(HttpStatus.OK).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
    });
  } catch (error) {
    console.error("Google token exchange error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: "Authentication failed",
    });
  }
};

/**
 * GET /api/auth/google/callback-popup
 * Alternative callback for popup window flow
 * Returns HTML that sends message to parent window
 */
export const handleGoogleCallbackPopup = async (
  req: Request,
  res: Response,
) => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== "string") {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send("<script>window.close();</script>");
    }

    // Exchange code for tokens (same logic as regular callback)
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    if (!userInfo.email || !isMivaEmail(userInfo.email)) {
      return res.send(`
        <script>
          window.opener.postMessage({ error: 'Only Miva emails allowed' }, '*');
          window.close();
        </script>
      `);
    }

    // Create/update user (same logic)
    let user = await prisma.user.findFirst({
      where: { OR: [{ email: userInfo.email }, { googleId: userInfo.id }] },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: userInfo.email,
          username: userInfo.email.split("@")[0],
          name: userInfo.name || "",
          googleId: userInfo.id,
          picture: userInfo.picture,
          email_verified: userInfo.verified_email ?? false,
          email_verified_at: userInfo.verified_email ? new Date() : null,
          last_login_with: "GOOGLE",
          last_login_at: new Date(),
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: userInfo.id,
          picture: userInfo.picture,
          email_verified: userInfo.verified_email ?? user.email_verified,
          email_verified_at: userInfo.verified_email
            ? new Date()
            : user.email_verified_at,
          last_login_with: "GOOGLE",
          last_login_at: new Date(),
        },
      });
    }

    const { accessToken, refreshToken } = AuthService.generateTokens(
      user.id,
      user.email,
    );

    // Send tokens to parent window via postMessage
    res.send(`
      <script>
        window.opener.postMessage({
          success: true,
          accessToken: '${accessToken}',
          refreshToken: '${refreshToken}',
          user: ${JSON.stringify({
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture,
          })}
        }, '*');
        window.close();
      </script>
    `);
  } catch (error) {
    console.error("Google popup callback error:", error);
    res.send(`
      <script>
        window.opener.postMessage({ error: 'Authentication failed' }, '*');
        window.close();
      </script>
    `);
  }
};
