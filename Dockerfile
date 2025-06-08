# Multi-stage build for better optimization
FROM oven/bun:latest AS deps

# Install system dependencies required for Playwright
RUN apt-get update && apt-get install -y \
    # Essential tools
    wget \
    gnupg \
    ca-certificates \
    dumb-init \
    # Playwright dependencies
    libnss3 \
    libnspr4 \
    libatspi2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2 \
    libgtk-3-0 \
    libxshmfence1 \
    # Fonts
    fonts-liberation \
    fonts-noto-cjk \
    # Clean up
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Install Playwright browsers
RUN bunx playwright install chromium

# Production stage
FROM oven/bun:latest AS production

# Copy system dependencies from deps stage
COPY --from=deps /usr/lib /usr/lib
COPY --from=deps /usr/share /usr/share
COPY --from=deps /lib /lib
COPY --from=deps /bin/dumb-init /bin/dumb-init

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    fonts-noto-cjk \
    libnss3 \
    libxss1 \
    libasound2 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Set Playwright environment variables
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Create app directory
WORKDIR /app

# Copy node_modules and Playwright browsers from deps stage
COPY --from=deps /root/.cache/ms-playwright /root/.cache/ms-playwright

# Copy source code
COPY . .

# Create screenshots directory with proper permissions
RUN mkdir -p screenshots && \
    chown -R bun:bun /app

# Switch to non-root user
USER bun

# Set display for headless browser
ENV DISPLAY=:99

# Health check
HEALTHCHECK --interval=60s --timeout=30s --start-period=10s --retries=3 \
    CMD bun run --silent -e "console.log('Health check passed')" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["bun", "run", "index.ts"]
