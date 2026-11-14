# syntax=docker/dockerfile:1
# สุ่มแบ่งกลุ่ม 4 สี — static pages + zero-dependency Node server.
FROM node:22-alpine

LABEL org.opencontainers.image.title="sport-spin" \
      org.opencontainers.image.description="ระบบสุ่มแบ่งกลุ่ม 4 สี สำนักงานปลัดกระทรวงการคลัง" \
      org.opencontainers.image.licenses="internal"

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATE_DIR=/var/lib/sport-state \
    TZ=Asia/Bangkok

WORKDIR /app

# Runtime code
COPY package.json server.cjs ./
COPY api ./api

# Static app + data the pages fetch
COPY index.html stage_random.html ./
COPY officials_live.json officials_504.json latest_spin.json performance-appraisal.users19.json ./
COPY img ./img
COPY uploads/photos ./uploads/photos

# Writable state (saved spins + avatars) lives on a mounted volume
RUN mkdir -p "$STATE_DIR/avatars" \
 && chown -R node:node /app "$STATE_DIR"

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "server.cjs"]