FROM ghcr.io/railwayapp/nixpacks:ubuntu-1745885067
WORKDIR /app
RUN apt-get update && apt-get install -y nginx
COPY . /app
RUN mkdir -p /etc/nginx /var/log/nginx /var/cache/nginx
RUN rm -f /etc/nginx/sites-enabled/default
RUN printf 'server {\n  listen 3000;\n  root /app/public;\n  index index.html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]