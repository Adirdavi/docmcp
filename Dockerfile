# Compile in the builder, ship plain JS. Running tsx in production meant carrying a
# dev tool into the runtime image and transpiling on every boot — wasteful anywhere,
# and actively bad on a free tier where a cold start already costs ~50s.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production OUT_DIR=/tmp/docmcp
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
# PORT is injected by the host; the app falls back to 8787 locally.
EXPOSE 8787
# Generated files live on the container filesystem on purpose: they expire after
# 24h anyway, so a restart only breaks links that were about to die. Everything
# that must survive — keys, quotas, the IP salt — is in Postgres.
CMD ["node", "dist/index.js"]
