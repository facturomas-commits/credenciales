module.exports = {
  apps: [
    {
      name: 'articulacion-2026',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        PORT: 3032,
        NODE_ENV: 'production'
      }
    }
  ]
};
