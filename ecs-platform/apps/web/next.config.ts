import type { NextConfig } from 'next';
const config:NextConfig={
  poweredByHeader:false,
  distDir:process.env.ECS_E2E==='true'?'.next-e2e':'.next',
  async rewrites(){return [{source:'/api/:path*',destination:`${process.env.API_ORIGIN??'http://127.0.0.1:4000'}/api/:path*`}];},
};
export default config;
