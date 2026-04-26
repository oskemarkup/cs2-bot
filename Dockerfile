FROM node:24-bookworm-slim

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.34

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" \
  && case "${ARCH}" in \
    amd64) SUPERCRONIC=supercronic-linux-amd64; SUPERCRONIC_SHA1SUM=e8631edc1775000d119b70fd40339a7238eece14 ;; \
    arm64) SUPERCRONIC=supercronic-linux-arm64; SUPERCRONIC_SHA1SUM=4ab6343b52bf9da592e8b4bb7ae6eb5a8e21b71e ;; \
    *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
  esac \
  && curl -fsSLO "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/${SUPERCRONIC}" \
  && echo "${SUPERCRONIC_SHA1SUM}  ${SUPERCRONIC}" | sha1sum -c - \
  && chmod +x "${SUPERCRONIC}" \
  && mv "${SUPERCRONIC}" "/usr/local/bin/${SUPERCRONIC}" \
  && ln -s "/usr/local/bin/${SUPERCRONIC}" /usr/local/bin/supercronic

RUN corepack enable && corepack prepare pnpm@10.9.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm build

ENV NODE_ENV=production

CMD ["node", "apps/worker/dist/cli.js", "health"]
