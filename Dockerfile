# Production Dockerfile for Railway deployment
FROM node:22-alpine

WORKDIR /app

# Install system dependencies for Prisma
RUN apk add --no-cache openssl

# Copy package files
COPY package.json package-lock.json* ./

# Copy Prisma schema BEFORE npm install (needed for postinstall hook)
COPY prisma ./prisma

# Install ALL dependencies (including dev dependencies needed for build)
RUN npm ci || npm install

# Copy source code and assets
COPY . .

# Generate Prisma client explicitly before build
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --omit=dev

# Expose port
EXPOSE ${PORT:-7292}

# Start command - run migrations then start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
