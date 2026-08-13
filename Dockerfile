# Every dependency is now pure JS (pg replaced the native better-sqlite3), so no
# build toolchain and no multi-stage build is needed.
FROM node:22-slim
WORKDIR /app
# PORT is injected by the host (Render, Koyeb, Cloud Run all set it); the app
# falls back to 8787 locally. Don't pin it here or the host's value gets ignored.
ENV NODE_ENV=production OUT_DIR=/tmp/docmcp
COPY package*.json ./
RUN npm ci --omit=dev && npm i tsx@4 --no-save
COPY src ./src
COPY public ./public
EXPOSE 8000
# Generated files live on the container filesystem on purpose: they expire after
# 24h anyway, so a restart only breaks links that were about to die. Everything
# that must survive — keys, quotas — is in Postgres via DATABASE_URL.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/index.ts"]
