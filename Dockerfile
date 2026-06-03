FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Precondition check: the powers-and-duties SQLite database must be pre-built
# on the host (the production stage will COPY it). Fail fast in the builder
# with a clear message rather than letting the production COPY fail later with
# a Docker-internal "file not found" error.
RUN test -f data/duties.db || (echo "ERROR: data/duties.db not found in build context." && echo "       Run 'npm run build-duties-db' on the host before 'docker build'." && exit 1)

# Build the application
RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application from builder with correct ownership
COPY --from=builder --chown=nodejs:nodejs /app/build ./build

# Copy the pre-built powers-and-duties SQLite database.
# The image is expected to include it; the operator must run
# `npm run build-duties-db` on the build host before `docker build`. The COPY
# below will fail with a clear error if the file is missing — see the
# precondition check, which runs in the builder stage where the build context
# is still available, so the failure surfaces before the production COPY.
COPY --chown=nodejs:nodejs data/duties.db ./data/duties.db

# Switch to non-root user
USER nodejs

# Set environment for HTTP transport
ENV MCP_TRANSPORT=http
ENV PORT=8080

# Expose the port
EXPOSE 8080

# No HEALTHCHECK — App Runner ignores it and uses its own health check config

# Start the server
CMD ["node", "build/index.js"]
