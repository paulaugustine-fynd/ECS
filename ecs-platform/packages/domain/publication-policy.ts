export function hasCurrentPublication(product:{version:number;publications:{target:string;version:number;status:string;externalId:string|null}[]}){
 return ['ERP','FYND','SFCC'].every(target=>product.publications.some(p=>p.target===target&&p.version===product.version&&p.status==='SUCCEEDED'&&Boolean(p.externalId)));
}
