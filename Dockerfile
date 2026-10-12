# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 LEFTHOOK=0
RUN npm install --global pnpm@12.10.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/form-schema/package.json packages/form-schema/package.json
COPY packages/form-renderer/package.json packages/form-renderer/package.json
COPY packages/ui/package.json packages/ui/package.json
# Root prepare installs Git hooks, which have no place in an image. Rebuild only
# the allowed native build tooling after the locked, script-free install.
RUN pnpm install --frozen-lockfile --config.engineStrict=true --ignore-scripts && \
    pnpm rebuild esbuild @sentry/cli

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL
# Build-only validation fixtures, never installation credentials. No database
# access or OAuth is performed during the build. Only the public URL is baked in.
RUN test -n "$NEXT_PUBLIC_APP_URL" && \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    AUTH_SECRET=build-only-validation-value-000000000000 \
    FINGERPRINT_SECRET=build-only-validation-value-000000000000 \
    WEBHOOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    AUTH_GITHUB_ID=build-only AUTH_GITHUB_SECRET=build-only \
    INNGEST_EVENT_KEY=build-only INNGEST_SIGNING_KEY=build-only \
    INNGEST_DEV=0 TRUST_PROXY=1 \
    APP_URL="$NEXT_PUBLIC_APP_URL" NEXTAUTH_URL="$NEXT_PUBLIC_APP_URL" \
    pnpm build && \
    node -e 'const fs=require("fs"); fs.writeFileSync("apps/web/build-public-url.json", JSON.stringify(process.env.NEXT_PUBLIC_APP_URL)); const dest="apps/web/.next/standalone/apps/web/node_modules/pg"; if(!fs.existsSync(dest)) fs.symlinkSync(fs.readlinkSync("apps/web/node_modules/pg"),dest)'

FROM dependencies AS migrate
COPY apps/web/drizzle apps/web/drizzle
COPY apps/web/drizzle.config.ts apps/web/drizzle.config.ts
COPY apps/web/src/db/schema.ts apps/web/src/db/schema.ts
COPY packages/form-schema packages/form-schema
USER node
WORKDIR /app/apps/web
CMD ["pnpm", "db:migrate"]

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
# Next bundles Zod into server chunks; the startup validator is a separate entry.
COPY --from=build /app/apps/web/node_modules/zod ./apps/web/node_modules/zod
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/build-public-url.json ./apps/web/build-public-url.json
COPY --from=build /app/apps/web/src/lib/production-config.ts ./apps/web/src/lib/production-config.ts
COPY --from=build /app/apps/web/drizzle ./apps/web/drizzle
COPY apps/web/scripts/start.mjs apps/web/scripts/readiness.mjs ./apps/web/scripts/
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
