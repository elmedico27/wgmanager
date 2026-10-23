# syntax=docker/dockerfile:1
# WG Manager web app. Build from the repository root:
#   docker build -t wgmanager:local .
#
# Base image: the official Node 26 (LTS) image on Alpine 3.24 (amd64 and arm64;
# tags checked in docker-library/official-images on 2026-10-22). Alpine's
# openssh-client-default provides ssh and depends on openssh-keygen and
# openssh-client-common (ssh-keygen, ssh-keyscan); checked in aports
# 3.24-stable main/openssh/APKBUILD (OpenSSH 10.3p1). tini (community, 0.19.0,
# installs /sbin/tini) runs as PID 1: the shared SSH connection detaches into
# the background, and Node as PID 1 does not reap such orphans, which leaves
# zombie processes (reproduced with Node as PID 1; none with tini).
# The tag is written out in each FROM line so Dependabot can update it.

# --- the UI --------------------------------------------------------------------
# The UI and the backend's dependency are the same on every CPU, so these two
# stages run on the builder's own platform (no emulation); see Docker's
# multi-platform docs (FROM --platform=$BUILDPLATFORM).
FROM --platform=$BUILDPLATFORM node:26.12.1-alpine3.24 AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- the backend's one dependency ----------------------------------------------------
FROM --platform=$BUILDPLATFORM node:26.12.1-alpine3.24 AS server
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- runtime -----------------------------------------------------------------------------
FROM node:26.12.1-alpine3.24
RUN apk add --no-cache openssh-client-default tini

WORKDIR /opt/wgmanager
COPY --from=server /src/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY --from=web /src/web/dist web/dist
# The host tool, copied out with `docker cp` by the install command the app shows.
COPY host/wgmanager-host host/wgmanager-helper host/README.md host/
COPY host/etc host/etc
COPY docker/wgmanager /usr/local/bin/wgmanager

# Root owns the program (read-only for the app); only /data belongs to the app.
RUN chown -R root:root /opt/wgmanager \
 && find /opt/wgmanager -type d -exec chmod 0755 {} + \
 && find /opt/wgmanager -type f -exec chmod 0644 {} + \
 && chmod 0755 /opt/wgmanager/host/wgmanager-host /opt/wgmanager/host/wgmanager-helper /usr/local/bin/wgmanager \
 && mkdir -p /data && chown node:node /data && chmod 0700 /data

ENV NODE_ENV=production \
    DATA_DIR=/data \
    LISTEN_PORT=7501
USER node
EXPOSE 7501

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LISTEN_PORT||7501)+'/api/session').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

LABEL org.opencontainers.image.title="WG Manager" \
      org.opencontainers.image.description="Web UI for a PiVPN WireGuard server" \
      org.opencontainers.image.source="https://github.com/elmedico27/wgmanager"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/opt/wgmanager/server/src/main.js"]
