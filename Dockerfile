# Portable build: works on any host with Docker.
#   docker build -t opus-cloud-mining .
#   docker run -p 3000:3000 opus-cloud-mining
# The build needs internet (next/font downloads Roboto once).
# Optimized: multi-stage build with production-only dependencies

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install only production dependencies to reduce image size
RUN npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Clean up any build artifacts and cache
RUN npm run build && \
    npm cache clean --force && \
    rm -rf /tmp/* /var/tmp/* /usr/local/share/.cache

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Create non-root user for security
RUN addgroup -S app && adduser -S app -G app
# Copy only necessary files from build stage
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# Set proper permissions
RUN chmod -R 755 /app/.next && \
    chown -R app:app /app
# Switch to non-root user
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
