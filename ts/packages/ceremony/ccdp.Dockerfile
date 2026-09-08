# SWS 3.0.0-beta.1, multi-platform image digest. Build context is dist-artifacts/.
FROM ghcr.io/static-web-server/static-web-server@sha256:4e804280b5b5b1be4563d4a9e0f3a0ea38e7887967d0cc00bc8c07030f529b3f
COPY --chown=sws:sws public/ /home/sws/public/
COPY --chown=sws:sws sws.toml /etc/sws.toml
ENV SERVER_CONFIG_FILE=/etc/sws.toml
