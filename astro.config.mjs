import { defineConfig } from 'astro/config';
import site from './src/data/site.json' with { type: 'json' };

export default defineConfig({
  site: site.url,
  build: { format: 'directory', inlineStylesheets: 'always' },
  compressHTML: true,
});
