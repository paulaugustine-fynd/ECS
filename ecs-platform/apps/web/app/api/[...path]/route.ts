import {createWebHandler} from '../../../../api/src/web-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = createWebHandler(async () => {
  const {createServer} = await import('../../../../api/src/server');
  return createServer();
});

async function dispatch(request:Request) {
  if (process.env.ECS_API_RUNTIME !== 'embedded') {
    return Response.json({error:{code:'API_RUNTIME_DISABLED',message:'Embedded API is not enabled'}},
      {status:503,headers:{'cache-control':'no-store'}});
  }
  return handle(request);
}

export {dispatch as GET,dispatch as HEAD,dispatch as POST,dispatch as PUT,dispatch as PATCH,dispatch as DELETE,dispatch as OPTIONS};
