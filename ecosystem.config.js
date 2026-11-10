module.exports = {
  apps: [{
    name: 'web-teadem',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      PORT: 3301,
      BACKEND_URL: 'http://172.168.20.183:3251'
    }
  }]
};
