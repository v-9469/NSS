# Use official lightweight Node.js Alpine base image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install runtime utilities & timezone data
RUN apk add --no-cache tzdata

# Set timezone
ENV TZ=Asia/Kolkata

# Copy package manifests
COPY package*.json ./

# Install dependencies cleanly
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Ensure storage directories exist
RUN mkdir -p /app/data /app/uploads

# Expose server port
EXPOSE 5000

# Set environment defaults
ENV NODE_ENV=production \
    PORT=5000 \
    DATA_DIR=/app/data \
    UPLOAD_DIR=/app/uploads

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/gallery', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"

# Launch server
CMD ["node", "server.js"]
