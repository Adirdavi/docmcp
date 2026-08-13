# better-sqlite3 is native; give it a toolchain in the builder, ship without one.
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/docmcp.db OUT_DIR=/data/out
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY public ./public
EXPOSE 8787
# /data must be a mounted volume — SQLite keys and generated files live there,
# and a container filesystem is wiped on every redeploy.
VOLUME ["/data"]
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/index.ts"]
