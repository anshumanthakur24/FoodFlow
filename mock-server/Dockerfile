# syntax=docker/dockerfile:1
FROM node:23-alpine3.21

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 python3-pip python3-venv python3-dev \
       build-essential ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN pip3 install --no-cache-dir \
      gdown \
      pandas \
      pymongo \
      tqdm \
      openpyxl \
      lxml

RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 5001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
