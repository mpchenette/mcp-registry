# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy OpenAPI spec and docs
COPY --from=builder /app/docs ./docs

# Create data directory for SQLite
RUN mkdir -p /mnt/data

# Expose port
EXPOSE 3000

# Run the application
CMD ["node", "dist/index.js"]
