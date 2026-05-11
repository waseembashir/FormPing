# ─── FormPing on Railway / any Docker host ──────────────────────────────────
#
# Bundles both the formping CLI and the Next.js UI into one image. The UI
# spawns the CLI via tsx, so both their node_modules trees need to be present
# at runtime. The Microsoft Playwright base image gives us Chromium + all the
# system libraries it depends on, so we don't have to fight apt.
#
# Volume: mount /app/data/snapshots to persist monitor snapshots across deploys.
# Port:   listens on $PORT (Railway injects this — defaults to 3000 locally).

FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Install formping (CLI) deps — include dev deps so tsx is available at runtime
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Install UI deps
COPY ui/package.json ui/package-lock.json* ./ui/
RUN cd ui && npm ci

# Now copy everything else (.dockerignore drops node_modules / .next / data / etc.)
COPY . .

# Build the Next.js UI for production
RUN cd ui && npm run build

# Where snapshots live — Railway volume gets mounted here at deploy time
RUN mkdir -p /app/data/snapshots

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Railway injects PORT; locally default to 3000
EXPOSE 3000
CMD sh -c "cd ui && npx next start -p ${PORT:-3000}"
