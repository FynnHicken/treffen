FROM node:22-alpine

WORKDIR /app

# build/build.js is a self-contained, pre-bundled server
COPY build ./build
COPY client ./client
COPY package.json ./

EXPOSE 8085
ENV PORT=8085

CMD ["node", "build/build.js"]
