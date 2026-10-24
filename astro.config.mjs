import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://fncreators.com',
  trailingSlash: 'always',
  integrations: [sitemap()],
  compressHTML: true,
  build: {
    format: 'directory',
  },
});
