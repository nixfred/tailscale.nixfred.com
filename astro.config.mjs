// @ts-check
import { defineConfig } from 'astro/config';

// tailscale.nixfred.com. Static output, Cloudflare Pages, no adapters.
export default defineConfig({
  site: 'https://tailscale.nixfred.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
});
