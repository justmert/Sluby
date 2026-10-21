import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  // a plain static site, the hosting is not tied to a node server
  output: 'export',
  // emit /page/index.html so any static file server resolves /page/
  trailingSlash: true,
  reactStrictMode: true,
};

export default withMDX(config);
