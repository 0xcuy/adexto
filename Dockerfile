# Production image for ADEXTO Protocol (Next.js 15 standalone)
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ── dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Factory addresses are inlined into the client bundle at build time, so they must
# be present here as well as at runtime.
ARG NEXT_PUBLIC_FACTORY_V2_0G
ARG NEXT_PUBLIC_FACTORY_V2_ARBITRUM
ARG NEXT_PUBLIC_FACTORY_V2_BASE
ARG NEXT_PUBLIC_FACTORY_V2_MONAD
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_EDGE_GATEWAY
ENV NEXT_PUBLIC_FACTORY_V2_0G=$NEXT_PUBLIC_FACTORY_V2_0G
ENV NEXT_PUBLIC_FACTORY_V2_ARBITRUM=$NEXT_PUBLIC_FACTORY_V2_ARBITRUM
ENV NEXT_PUBLIC_FACTORY_V2_BASE=$NEXT_PUBLIC_FACTORY_V2_BASE
ENV NEXT_PUBLIC_FACTORY_V2_MONAD=$NEXT_PUBLIC_FACTORY_V2_MONAD
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_EDGE_GATEWAY=$NEXT_PUBLIC_EDGE_GATEWAY

RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Durable location for the project registry and trade telemetry.
# The previous image had no writable path: /app and /app/public are owned by root
# with mode 755 while the process runs as uid 1001, so every registry and telemetry
# write failed with EACCES. Launch records only survived in one process's memory
# and vanished on restart, and POST /api/agent/telemetry returned 500.
ENV ADEXTO_DATA_DIR=/app/data

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/prices').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
