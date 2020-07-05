FROM node:14-alpine

WORKDIR /imaged
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --production

CMD ["node", "--enable-source-maps", "dist/app.js"]
