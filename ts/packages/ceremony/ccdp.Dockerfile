# SWS 2.44.0, multi-platform image digest. Build context is dist-artifacts/.
FROM ghcr.io/static-web-server/static-web-server@sha256:e36186455d3b78704c8ceeeab625e40edd1e7b0dd1b15fb042cbba298c452366
COPY --chown=sws:sws public/ /home/sws/public/
COPY --chown=sws:sws sws.toml /etc/sws.toml
ENV SERVER_CONFIG_FILE=/etc/sws.toml
