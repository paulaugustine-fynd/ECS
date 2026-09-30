import {createWebHandler} from '../../../../api/src/web-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const handle = createWebHandler(async () => {
  const {bootstrapHostedDemo}=await import('../../../../api/src/hosted-bootstrap');
  await bootstrapHostedDemo();
  const {createServer} = await import('../../../../api/src/server');
  return createServer();
});

async function dispatch(request:Request) {
  if (process.env.ECS_API_RUNTIME !== 'embedded') {
    return Response.json({error:{code:'API_RUNTIME_DISABLED',message:'Embedded API is not enabled'}},
      {status:503,headers:{'cache-control':'no-store'}});
  }
  const response=await handle(request);
  if(process.env.ECS_HOSTED_DEMO_PROJECT&&response.ok&&request.headers.has('cookie')){
    try{const {runHostedWorker}=await import('../../../../worker/src/hosted');await runHostedWorker();}
    catch{console.error('Hosted demo dispatcher deferred work; durable jobs are retained for the next attempt');}
  }
  return response;
}

export {dispatch as GET,dispatch as HEAD,dispatch as POST,dispatch as PUT,dispatch as PATCH,dispatch as DELETE,dispatch as OPTIONS};
