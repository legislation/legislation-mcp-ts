FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

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
