# ==========================================
# STAGE 1: Install dependencies
# ==========================================
FROM oven/bun:1.1-alpine AS deps
WORKDIR /app

# Copy dependency definition files
COPY package.json bun.lock ./

# Install dependencies strictly from lockfile
RUN bun install --frozen-lockfile

# ==========================================
# STAGE 2: Build the application
# ==========================================
FROM oven/bun:1.1-alpine AS builder
WORKDIR /app

# Copy dependencies and application source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Inject Build-time ARG for frontend API resolution (critical for client-side builds)
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

# Build Next.js project
RUN bun run build

# ==========================================
# STAGE 3: Production runner
# ==========================================
FROM oven/bun:1.1-alpine AS runner
WORKDIR /app

LABEL maintainer="Docker Expert" \
      description="Production Dockerfile for Next.js Frontend using Bun"

ENV NODE_ENV=production \
    PORT=3000

# Create a minimal non-root user/group for security hardening
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# Copy runtime assets and build outputs with correct ownership
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Switch to the non-root user
USER nextjs

# Expose Next.js server port
EXPOSE 3000

# Health check using Alpine's built-in wget utility
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the Next.js production server
CMD ["bun", "run", "start"]
