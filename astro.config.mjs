// @ts-check
import { defineConfig } from 'astro/config';
import remarkCallouts from './src/lib/remark-callouts.mjs';

// tailscale.nixfred.com. Static output, Cloudflare Pages, no adapters.
export default defineConfig({
  site: 'https://tailscale.nixfred.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  markdown: {
    remarkPlugins: [remarkCallouts],
    shikiConfig: {
      theme: 'github-dark-default',
    },
  },
});
