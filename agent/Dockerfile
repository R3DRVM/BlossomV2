# Blossom Agent Backend - Production Dockerfile
FROM node:20-slim

# Install dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy pre-built bundled server
COPY dist/server-bundle.js ./dist/server-bundle.js
COPY dist/server-bundle.js.map ./dist/server-bundle.js.map

# Copy schema for database initialization
COPY dist/schema.sql ./dist/schema.sql

# Copy execution-ledger and telemetry directories for runtime
COPY execution-ledger ./execution-ledger
COPY telemetry ./telemetry

# Create data directory for SQLite
RUN mkdir -p /data

# Expose port
EXPOSE 3001

# Start the server using the bundled JS
CMD ["node", "dist/server-bundle.js"]
