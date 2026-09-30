import {describe,it,expect} from 'vitest';
import {hasCurrentPublication} from '../../packages/domain/publication-policy';

describe('current catalogue evidence',()=>{
 const product={version:2,publications:['ERP','FYND','SFCC'].map(target=>({target,version:2,status:'SUCCEEDED',externalId:`mock-${target}`}))};
 it('requires all three acknowledged identities at the current version',()=>{
  expect(hasCurrentPublication(product)).toBe(true);
  for(const target of ['ERP','FYND','SFCC']){
   expect(hasCurrentPublication({...product,publications:product.publications.filter(p=>p.target!==target)})).toBe(false);
   for(const change of [{version:1},{status:'FAILED'},{externalId:null}])expect(hasCurrentPublication({...product,publications:product.publications.map(p=>p.target===target?{...p,...change}:p)})).toBe(false);
  }
 });
});
