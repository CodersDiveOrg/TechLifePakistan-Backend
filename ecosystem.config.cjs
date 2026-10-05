// PM2 process file for the VPS:  pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'techlife-api',
      cwd: __dirname,
      script: 'node_modules/@strapi/strapi/bin/strapi.js',
      args: 'start',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      time: true,
    },
  ],
};
