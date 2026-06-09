FROM docker.io/openzeppelin/openzeppelin-relayer:v1.5.0

USER root
RUN apk add --no-cache caddy

COPY plugins/channels /app/plugins/channels
RUN cd /app/plugins/channels && pnpm install --prod --frozen-lockfile \
    && mkdir -p /app/config/keys \
    && chown -R nonroot /app/plugins/channels /app/config

COPY --chown=nonroot config/config.json /app/config/config.json
COPY --chown=nonroot config/networks /app/config/networks
COPY --chown=nonroot Caddyfile /app/Caddyfile
RUN API_KEY=placeholder caddy validate --config /app/Caddyfile --adapter caddyfile
COPY --chown=nonroot entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER nonroot
ENV IN_DOCKER=true
ENTRYPOINT ["/app/entrypoint.sh"]
