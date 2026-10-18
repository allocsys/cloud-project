# Moving hosts

The app ships as a Docker image, so any host that runs containers can run it (Railway, Fly.io, Render, a VPS, Cloud Run).

```
docker build -t opus-cloud-mining .
docker run -p 3000:3000 opus-cloud-mining
```

Or `docker compose up --build`. Health check: `GET /api/health`.

- **Port:** reads `PORT` (default 3000).
- **Env:** `PRICE_FEED=static` turns off the CoinGecko feed. Nothing else is required yet.
- **Data:** stored in memory, so it resets on every restart or deploy. Move to Postgres before real users (see `lib/server/README.md`).
- **HTTPS:** put the container behind a proxy or the host's TLS. The PWA install and the service worker need HTTPS.
- **Scaling:** run one instance until the data is in Postgres, because each instance has its own memory.
- **Railway:** unchanged. It still builds with `npm run build` and starts with `next start`.
