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
  process.env.GOOGLE_CALLBACK_URL ||
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
    if (userInfo.email && !userInfo.email.endsWith("@miva.edu.ng")) {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      return res.redirect(
        `${frontendUrl}/login?error=not_miva_student`
      );
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
      sameSite: "lax",
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

    const frontendOrigin = process.env.FRONTEND_URL || "http://localhost:3000";

    if (!userInfo.email || !isMivaEmail(userInfo.email)) {
      return res.send(`
        <script>
          window.opener.postMessage({ error: 'Only Miva emails allowed' }, '${frontendOrigin}');
          window.close();
        </script>
      `);
    }

    // ✅ STEP 3: Upsert user via shared service
    const user = await upsertGoogleUser(userInfo);

    const { accessToken, refreshToken } = AuthService.generateTokens(
      user.id,
      user.email,
    );

    // Send tokens to parent window via postMessage (scoped to frontend origin)
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
        }, '${frontendOrigin}');
        window.close();
      </script>
    `);
  } catch (error) {
    console.error("Google popup callback error:", error);
    const frontendOrigin = process.env.FRONTEND_URL || "http://localhost:3000";
    res.send(`
      <script>
        window.opener.postMessage({ error: 'Authentication failed' }, '${frontendOrigin}');
        window.close();
      </script>
    `);
  }
};

/**
 * POST /api/auth/refresh
 * Issues a new accessToken (+ rotates refreshToken) from a valid refreshToken cookie.
 */
export const refreshAuthToken = async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ error: "No refresh token provided" });
    }

    let payload: { userId: string };
    try {
      payload = AuthService.verifyRefreshToken(token) as { userId: string };
    } catch {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ error: "Invalid or expired refresh token" });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ error: "User not found" });
    }

    // Rotate both tokens
    const { accessToken, refreshToken } = AuthService.generateTokens(user.id, user.email);

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 15 * 60 * 1000, // 15 min
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.status(HttpStatus.OK).json({
      success: true,
      accessToken,
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    return res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: "Token refresh failed" });
  }
};
