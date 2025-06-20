# Multi-stage build for better optimization
FROM oven/bun:latest

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

RUN bunx playwright install

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . .

HEALTHCHECK --interval=5m --timeout=3s \
  CMD echo hi

# Run the server when the container launches
ENTRYPOINT ["bun", "run", "index.ts"]
