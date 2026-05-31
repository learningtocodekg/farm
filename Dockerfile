# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm install

# Copy source code and build
COPY frontend/ ./
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from build stage
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Cloud Run expects the container to listen on port 8080 by default
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
