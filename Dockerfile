# syntax=docker/dockerfile:1.7

# ---- base ---------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- deps ---------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

# ---- typecheck ----------------------------------------------------------
FROM base AS typecheck
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm typecheck

# ---- runtime ------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 1001 ninshubur \
 && useradd --system --uid 1001 --gid ninshubur --create-home ninshubur

COPY --from=deps --chown=ninshubur:ninshubur /app/node_modules ./node_modules
COPY --chown=ninshubur:ninshubur package.json pnpm-lock.yaml* ./
COPY --chown=ninshubur:ninshubur tsconfig.json ./
COPY --chown=ninshubur:ninshubur src ./src
COPY --chown=ninshubur:ninshubur drizzle ./drizzle

USER ninshubur

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["pnpm", "start"]

# Override at run time, e.g.:
#   docker run --rm ninshubur:latest pnpm cli backfill --channel 123
#   docker run --rm ninshubur:latest pnpm cli migrate
#   docker run --rm ninshubur:latest pnpm cli health
