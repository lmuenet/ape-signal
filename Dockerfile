# Depot-UI only (ADR 0004): the core (scans, ticks, listener, claude CLI)
# stays on systemd. This container serves the read-only UI over DATA_DIR.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
ENV DATA_DIR=/data \
    UI_PORT=8744
EXPOSE 8744
USER node
CMD ["npx", "tsx", "src/ui/main.ts"]
