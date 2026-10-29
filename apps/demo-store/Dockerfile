# The AgentPOS sidecar for the public Arc testnet demo store. Built from the repository root:
#   docker build -f apps/demo-store/Dockerfile -t agentpos-arc-demo .
# The core packages come from npm (published with provenance); the Arc rail is built from source.
FROM node:22-alpine AS build
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter @agentpos/arc-demo-store... \
 && pnpm --filter @agentpos/rail-arc build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The sidecar signs nothing and holds no funds, but it does hold the Woo REST key: never root.
USER node
COPY --from=build --chown=node:node /app /app
# /data holds agentpos.config.json and the .agentpos dir (SQLite + receipt signer). Mount it.
WORKDIR /data
EXPOSE 8402
CMD ["node", "/app/apps/demo-store/serve.mjs"]
