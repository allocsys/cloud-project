# Build from this folder:  docker build -t vtx-backup backup/
# On Railway: new service, Root Directory = backup, Cron Schedule = 0 3 * * *, Watch Paths = backup/**
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=app:app src ./src
USER app
CMD ["node", "src/run.js"]
