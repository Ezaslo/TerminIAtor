FROM node:24-bookworm

ARG TERRAFORM_VERSION=1.15.8

WORKDIR /app

# Outils nécessaires à Terraform
RUN sed -i "s|http://deb.debian.org|https://deb.debian.org|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# Installation de Terraform selon l'architecture du serveur
RUN set -eux; \
    ARCH="$(dpkg --print-architecture)"; \
    case "${ARCH}" in \
        amd64) TF_ARCH="amd64" ;; \
        arm64) TF_ARCH="arm64" ;; \
        *) echo "Architecture non supportée : ${ARCH}" && exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/terraform.zip \
      "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${TF_ARCH}.zip"; \
    unzip /tmp/terraform.zip -d /usr/local/bin; \
    rm /tmp/terraform.zip; \
    terraform version

# Installation des dépendances Node
COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# Copie de Privalyse
COPY --chown=node:node . .

# Les dossiers Terraform de chaque session seront persistés
# par Docker Compose.
RUN mkdir -p /app/terraform-sessions \
    && chown -R node:node /app

USER node

ENV NODE_ENV=production

EXPOSE 3001
EXPOSE 3002

CMD ["node", "server.js"]root@N8N:/opt/privalyse/web# nano Dockerfile
root@N8N:/opt/privalyse/web# nano Dockerfile
root@N8N:/opt/privalyse/web# cat Dockerfile
FROM node:24-bookworm

ARG TERRAFORM_VERSION=1.15.8

WORKDIR /app

# Outils nécessaires à Terraform
RUN sed -i "s|http://deb.debian.org|https://deb.debian.org|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# Installation de Terraform selon l'architecture du serveur
RUN set -eux; \
    ARCH="$(dpkg --print-architecture)"; \
    case "${ARCH}" in \
        amd64) TF_ARCH="amd64" ;; \
        arm64) TF_ARCH="arm64" ;; \
        *) echo "Architecture non supportée : ${ARCH}" && exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/terraform.zip \
      "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${TF_ARCH}.zip"; \
    unzip /tmp/terraform.zip -d /usr/local/bin; \
    rm /tmp/terraform.zip; \
    terraform version

# Installation des dépendances Node
COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# Copie de Privalyse
COPY --chown=node:node . .

# Les dossiers Terraform de chaque session seront persistés
# par Docker Compose.
RUN mkdir -p /app/terraform-sessions \
    && chown -R node:node /app

USER node

ENV NODE_ENV=production

EXPOSE 3001
EXPOSE 3002

CMD ["node", "server.js"]