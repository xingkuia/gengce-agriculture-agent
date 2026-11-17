FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.html tsconfig.json tsconfig.app.json tsconfig.server.json vite.config.ts ./
COPY src ./src
COPY server ./server
RUN pnpm build

FROM node:24-alpine AS production-deps

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_PATH=/data/agri.db
WORKDIR /app

RUN mkdir -p /data && chown -R node:node /data

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --chown=node:node package.json ./

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=12s --retries=3 \
  CMD node -e "fetch('http://localhost:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist-server/index.js"]
