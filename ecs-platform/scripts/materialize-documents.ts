import { db } from '../packages/db/client';
import { sampleDocument,sampleApplication } from '../prisma/document-fixtures';
import { audit,transaction,json } from '../packages/db/transaction';
const url=new URL(process.env.DATABASE_URL??'');
if(process.env.DEMO_MODE!=='true'||process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_demo')throw new Error('Sample materialization is local-demo only');
try{
  const docs=await db.document.findMany({where:{checksum:'fixture-not-uploaded',scanStatus:'LEGACY_METADATA',id:{startsWith:'doc_'}}});
  for(const doc of docs){const metadata=await sampleDocument(doc.partnerId,doc.type);await transaction(async tx=>{const actor=await tx.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});const changed=await tx.document.updateMany({where:{id:doc.id,checksum:'fixture-not-uploaded'},data:metadata});if(changed.count)await audit(tx,actor,'fixture-documents','demo.materialize-sample',doc.id,null,{checksum:metadata.checksum,type:doc.type},'Created fictional evidence bytes for legacy sample metadata',doc.partnerId);});}
  const p=await db.partner.findUnique({where:{id:'vnd_onboard'}});
  if(p&&JSON.stringify(p.application)==='{}')await db.partner.update({where:{id:p.id},data:{application:json(sampleApplication),version:{increment:1}}});
  console.log(`Materialized ${docs.length} fictional sample documents. Existing uploaded files and business decisions were preserved.`);
}finally{await db.$disconnect();}
