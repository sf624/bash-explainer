FROM alpine:3.20
ARG VERSION=1.2.3
RUN apk add --no-cache curl jq \
    # tools for the healthcheck
    && rm -rf /var/cache/apk/*
RUN --mount=type=cache,target=/root/.cache [[ -n "$VERSION" ]] && echo "v$VERSION"
RUN ["echo", "exec form is not a shell"]
RUN <<EOF
set -eu
curl -fsSL "https://example.com/app-${VERSION}.tar.gz" | tar -xz -C /opt
EOF
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN for f in /opt/*.conf; do sed -i 's/^#\(listen\)/\1/' "$f"; done &> /dev/null
CMD exec /opt/app --port "${PORT:-8080}"
CMD ["sh", "-c", "exec /opt/app --port \"${PORT:-8080}\" 2>&1 | tee /var/log/app.log"]
ENTRYPOINT ["/opt/app", "--config", "$HOME/app.conf", \
            "--name", "it's"]
RUN curl -fsSL https://example.com/setup.sh | bash
