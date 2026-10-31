FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ARG XRAY_SHA256
COPY vendor/xray /usr/local/bin/xray
RUN test -n "$XRAY_SHA256" \
    && printf '%s  /usr/local/bin/xray\n' "$XRAY_SHA256" | sha256sum -c - \
    && chmod 755 /usr/local/bin/xray \
    && /usr/local/bin/xray version
WORKDIR /app
COPY --chown=node:node server.mjs /app/server.mjs
USER node
ENV PORT=9000
EXPOSE 9000
CMD ["node", "/app/server.mjs"]
