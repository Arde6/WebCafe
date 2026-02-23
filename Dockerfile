FROM node:20-slim
WORKDIR /app

# Install Python and build essentials for native modules
RUN apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD [ "node", "server.js" ]