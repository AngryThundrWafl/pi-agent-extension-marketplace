# Local development image for the Pi package catalog monorepo.
#
# Build:  docker build -t pi-catalog-dev .
# Run:    docker run --rm -it pi-catalog-dev bash
# Inside the container, the repo is at /app with dev dependencies installed:
#   npm run check        # typecheck + lint + audit + test + catalog:check + verify:install
#   npm run typecheck
#   npm run lint
#   npm test
#
# Optional live-mount flow (requires a Docker daemon that shares the host
# filesystem, e.g. Docker Desktop or a Linux host):
#   docker run --rm -it -v "$PWD":/app -w /app pi-catalog-dev bash
# Note: the mount shadows the baked-in /app, so re-run npm ci inside the
# container on first use (or ensure the host already has node_modules).
#
# The image installs dev dependencies (typecheck/lint/test tooling) and sets
# offline-safe Pi env vars so tests and ad-hoc Pi runs never hit the network.
FROM node:22.19.0-bookworm-slim

ENV NODE_ENV=development \
    PI_OFFLINE=1 \
    PI_SKIP_VERSION_CHECK=1 \
    PI_TELEMETRY=0

WORKDIR /app
RUN chown node:node /app

# Install dependencies first for layer caching (only re-runs when manifests change).
# Run as the unprivileged `node` user so files stay writable inside mounted volumes.
COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci --ignore-scripts --no-audit --no-fund

# Copy the rest of the repository (node_modules is excluded via .dockerignore).
COPY --chown=node:node . .

CMD ["bash"]
