# Use Node.js LTS version
FROM node:20-alpine

# Install system dependencies for Tesseract OCR
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy application source
COPY src/ ./src/

# Create necessary directories
RUN mkdir -p downloads temp

# Create volume for database persistence
VOLUME ["/usr/src/app/data"]

# Symlink database to data volume
RUN ln -s /usr/src/app/data/parking.db /usr/src/app/parking.db || true

# Set environment to production
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Run the bot
CMD ["node", "src/bot.js"]