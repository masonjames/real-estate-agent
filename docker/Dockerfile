# syntax=docker/dockerfile:1

# Real Estate Agent - Next.js with Playwright
# For use with Dokploy GitHub/GHCR deployments
#
# Best Practices Applied:
# - Multi-stage build (deps → builder → runner)
# - Non-root user (nextjs:nodejs)
# - HEALTHCHECK for service readiness
# - Playwright with Chromium for browser automation
#
# Usage: Build via GitHub Actions, deploy to Dokploy

FROM node:20-slim AS base
WORKDIR /app

# Install dependencies stage
FROM base AS deps

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Build stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set Next.js to standalone mode
ENV NEXT_TELEMETRY_DISABLED=1

# Provide dummy environment variables for build-time
# These are required because Neon and Better Auth initialize at module load time
# Real values are injected at runtime via Dokploy
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require"
ENV BETTER_AUTH_SECRET="build-time-placeholder-will-be-replaced-at-runtime"

RUN npm run build

# Production stage
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Install Playwright dependencies and Chromium
# Required for browser automation (PAO property search)
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    # Fonts for proper rendering
    fonts-liberation \
    # Utilities
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (Debian syntax)
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Install Playwright and download Chromium as root first
RUN npx playwright install chromium

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Playwright browsers (installed as root, readable by all)
# The browsers are in /root/.cache/ms-playwright, we need to make them accessible
RUN mkdir -p /home/nextjs/.cache && \
    cp -r /root/.cache/ms-playwright /home/nextjs/.cache/ms-playwright && \
    chown -R nextjs:nodejs /home/nextjs/.cache

USER nextjs

# Set Playwright to use the copied browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/home/nextjs/.cache/ms-playwright

EXPOSE 3000

# Health check - verify port is listening
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => process.exit(r.statusCode ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
