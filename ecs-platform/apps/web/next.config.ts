import type { NextConfig } from 'next';
const config:NextConfig={
  poweredByHeader:false,
  env:{NEXT_PUBLIC_ECS_HOSTED_DEMO:process.env.ECS_HOSTED_DEMO_PROJECT?'true':'false'},
  distDir:process.env.ECS_E2E==='true'?'.next-e2e':'.next',
  serverExternalPackages:['fastify','@fastify/swagger','@fastify/swagger-ui'],
  async rewrites(){return {beforeFiles:process.env.ECS_API_RUNTIME==='embedded'?[]:[{source:'/api/:path*',destination:`${process.env.API_ORIGIN??'http://127.0.0.1:4000'}/api/:path*`}],afterFiles:[],fallback:[]};},
};
export default config;
