# Build from this folder:  docker build -t vtx-gateway gateway/
# On Railway set the service Root Directory to gateway.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000
RUN addgroup -S app && adduser -S app -G app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=app:app src ./src
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
