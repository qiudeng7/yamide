FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && apt-get clean
RUN npm install -g pnpm@11.19.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts=false
COPY apps/server apps/server
RUN pnpm --filter @yamide/server build
RUN mkdir -p /home/node/.yamide /projects && chown node:node /home/node/.yamide /projects
ENV YAMIDE_ROOT=/projects YAMIDE_STATE_DIR=/home/node/.yamide
EXPOSE 3000
USER node
CMD ["node", "apps/server/dist/main.js"]
