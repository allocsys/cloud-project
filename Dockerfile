# Portable build: works on any host with Docker.
#   docker build -t vertexhash .
#   docker run -p 3000:3000 vertexhash
# The build needs internet (next/font downloads Roboto once).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
# all (default) = pages and API in one server; web = pages only; api = API only. Set it as a build variable and at runtime.
ARG APP_ROLE=all
ENV APP_ROLE=$APP_ROLE
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ARG APP_ROLE=all
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 APP_ROLE=$APP_ROLE
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+(process.env.HEALTH_PATH||(process.env.APP_ROLE==='web'?'/healthz':'/api/health'))).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
