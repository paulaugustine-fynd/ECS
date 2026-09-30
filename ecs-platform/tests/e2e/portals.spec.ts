import {test,expect,type Page} from '@playwright/test';
import sharp from 'sharp';
import {zipParts} from '../helpers/xlsx';
import {importFields} from '../../packages/domain/catalog-fields';
import {signIn} from './auth';
async function login(page:Page,email:string){await signIn(page,email);await expect(page.getByRole('heading',{name:'Concessions overview',exact:true})).toBeVisible();}

test('vendor maps source fields, previews conversions and submits a retained batch for review',async({page})=>{
 await login(page,'catalog@lumera.demo');await page.goto('/vendor/catalog/imports');
 const prefix='629988000091',check=(10-[...prefix].reverse().reduce((sum,c,i)=>sum+Number(c)*(i%2?1:3),0)%10)%10;
 const row:Record<string,string>={partner_code:'VND-LUM',brand:'Lumera',vendor_sku:'E2E-MAPPING-LIP',gtin:prefix+check,parent_sku:'E2E-MAPPING-PARENT',title_en:'Mapped silken coral pigment',title_ar:'صبغة مرجانية',category:'Lips',colour:'Midnight',size:'One Size',list_price:'160',selling_price:'145',currency:'AED',image_url:'/demo-assets/lum-lip-ruby.svg',location_code:'LUM-DXB-WH01',quantity:'3',finish:'Satin',country_of_origin:'France'};
 const headers=[...importFields.map(f=>f==='colour'?'shade':f==='category'?'department':f),'supplier_notes'];
 const csv=headers.join(',')+'\n'+[...importFields.map(f=>row[f]??''),'Original supplier note'].map(v=>JSON.stringify(v)).join(',');
 await page.getByLabel('Catalogue file',{exact:true}).setInputFiles({name:'supplier-assortment.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 const save=page.getByRole('button',{name:'Validate and save batch',exact:true});await expect(save).toBeDisabled();
 await page.getByRole('button',{name:'Preview source columns',exact:true}).click();await expect(page.locator('[aria-label="Source field mapping"]').getByRole('status')).toContainText('Mapping incomplete');
 await page.getByRole('combobox',{name:'Map colour',exact:true}).selectOption('shade');await page.getByRole('combobox',{name:'Map category',exact:true}).selectOption('department');
 await page.getByText('Unused columns and exact value conversions',{exact:true}).click();await page.getByRole('checkbox',{name:'Ignore supplier_notes',exact:true}).check();
 await page.getByRole('button',{name:'Add value conversion',exact:true}).click();await page.getByLabel('Source value 1',{exact:true}).fill('Lips');await page.getByLabel('ATI value 1',{exact:true}).fill('Beauty/Makeup/Lips');
 await page.getByRole('button',{name:'Add value conversion',exact:true}).click();await page.getByRole('combobox',{name:'Conversion field 2',exact:true}).selectOption('colour');await page.getByLabel('Source value 2',{exact:true}).fill('Midnight');await page.getByLabel('ATI value 2',{exact:true}).fill('Black');
 await expect(save).toBeDisabled();await page.getByRole('button',{name:'Refresh mapping preview',exact:true}).click();await expect(page.locator('[aria-label="Source field mapping"]').getByRole('status')).toContainText('Mapping ready');
 await expect(page.locator('[aria-label="Source field mapping"] table')).toContainText('Midnight');await expect(page.locator('[aria-label="Source field mapping"] table')).toContainText('Black');await expect(save).toBeEnabled();
 await page.screenshot({path:test.info().outputPath('source-mapping-preview.png'),fullPage:true});await save.click();await expect(page).toHaveURL(/\/vendor\/catalog\/imports\/[^/]+$/);
 await page.getByText('Retained source mapping · version 1',{exact:true}).click();await expect(page.getByText('colour: Midnight → Black',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Submit 1 products for review',exact:true}).click();await expect(page.getByText('1 products created in review.',{exact:false})).toBeVisible();
 await page.getByRole('link',{name:'Review product →',exact:true}).click();await expect(page.getByLabel('English title',{exact:true})).toHaveValue(row.title_en);await expect(page.locator('.detail-heading')).toContainText('in review');
});

test('operator and vendor have separate authorized portals; onboarding remains separate',async({page})=>{
  // Delay only the first real session read; no response or token is fabricated.
  let releaseSession!:()=>void;const sessionGate=new Promise<void>(resolve=>{releaseSession=resolve;});
  await page.route('**/api/v1/auth/me',async route=>{await sessionGate;await route.continue();},{times:1});
  try{await login(page,'admin@ati.demo');await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeDisabled();}finally{releaseSession();}
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/login$/);
 await login(page,'admin@maisonazure.demo');await page.goto('/operator/dashboard');await expect(page).toHaveURL(/\/vendor\/dashboard$/);
 await page.getByRole('link',{name:'My products',exact:true}).click();await expect(page.getByRole('heading',{name:'My products',exact:true})).toBeVisible();
 await expect(page.getByText('MAZ-DRS-1001-BLK-M',{exact:false})).toBeVisible();await expect(page.getByText('LUM-SRM-3001-30ML',{exact:false})).toHaveCount(0);
 await page.getByRole('button',{name:'العربية',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(page.getByRole('heading',{name:'منتجاتي',exact:true})).toBeVisible();
 await page.goto('/onboarding');await expect(page.locator('.bloom')).toBeVisible();await expect(page.locator('.console-main')).toHaveCount(0);await expect(page.locator('.bloom-footer')).toBeVisible();
});

test('guessed partner product is denied by the server without data or mutation',async({page})=>{
 await login(page,'admin@maisonazure.demo');
 const denied=page.waitForResponse(r=>r.url().endsWith('/api/v1/catalog/items/prd_lum_serum_3001')&&r.request().method()==='GET');
 await page.goto('/vendor/catalog/items/prd_lum_serum_3001');expect((await denied).status()).toBe(404);await expect(page.locator('.catalog-detail').getByRole('alert')).toContainText('Product not found');
 await expect(page.getByText('Loading product…',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('English title')).toHaveCount(0);
 const me=await (await page.request.get('/api/v1/auth/me')).json();
 const forbidden=await page.request.post('/api/v1/catalog/items/prd_lum_serum_3001/draft',{headers:{'x-csrf-token':me.csrfToken},data:{expectedVersion:1,titleEn:'Unauthorized change',titleAr:'تغيير',gtin:'4006381333931',price:'1.00',attributes:{}}});
 expect(forbidden.status()).toBe(404);expect(await forbidden.text()).not.toContain('Lumera');
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/login$/);await login(page,'admin@ati.demo');
 const untouched=await (await page.request.get('/api/v1/catalog/items/prd_lum_serum_3001')).json();expect(untouched).toMatchObject({titleEn:'Lumera Radiance Vitamin C Serum 30 ml',version:1,status:'PUBLISHED'});
});

test('durable DAM imports exhaust retries and recover through ATI-only replay',async({browser})=>{
 const vendor=await browser.newContext(),operator=await browser.newContext(),v=await vendor.newPage(),a=await operator.newPage();
 try{
  await login(v,'admin@maisonazure.demo');await v.goto('/vendor/catalog/items/e2e_dam_draft');await v.getByRole('combobox',{name:'Demo failure scenario',exact:true}).selectOption('3');await v.getByRole('button',{name:'Queue DAM import',exact:true}).click();
  await expect.poll(async()=>{const refresh=v.getByRole("button",{name:"Refresh DAM jobs",exact:true});await refresh.click();await expect(refresh).toBeEnabled();return v.getByRole('group',{name:'DAM job studio-front'}).textContent();},{timeout:30000}).toContain("DLQ");
  await expect(v.getByRole('button',{name:'Replay DAM job',exact:true})).toHaveCount(0);
  await login(a,'admin@ati.demo');await a.goto('/operator/catalog/items/e2e_dam_draft');await a.getByLabel('DAM replay reason').fill('Reviewed simulated source failure and confirmed recovery');await a.getByRole('button',{name:'Replay DAM job',exact:true}).click();
  await expect.poll(async()=>{const refresh=a.getByRole("button",{name:"Refresh DAM jobs",exact:true});await refresh.click();await expect(refresh).toBeEnabled();return a.getByRole('group',{name:'DAM job studio-front'}).textContent();},{timeout:30000}).toContain("SUCCEEDED");
  await expect(a.getByRole('group',{name:'DAM job studio-front'})).toContainText('4 attempts');await expect(a.locator('.media-review img')).toHaveCount(1);await expect(a.locator('.media-review .badge')).toHaveText('pending');await expect(a.locator('.detail-heading')).toContainText('draft');
 }finally{await vendor.close();await operator.close();}
});

test('vendor edits and submits; ATI approves and publishes through real local mock acknowledgements',async({browser})=>{
 const vendor=await browser.newContext(),operator=await browser.newContext();const v=await vendor.newPage(),a=await operator.newPage();
 try{
  await login(v,'admin@maisonazure.demo');await v.goto('/vendor/catalog/items/e2e_catalog_draft');
  await v.getByLabel('English title',{exact:true}).fill('Browser verified silk dress');await v.getByRole('button',{name:'Save and validate draft',exact:true}).click();await expect(v.getByRole('status')).toContainText('Draft saved');
  const pixels=await sharp({create:{width:256,height:256,channels:3,background:'#ddeeff'}}).png().toBuffer();
  await v.getByLabel('Choose product image',{exact:true}).setInputFiles({name:'browser-image.png',mimeType:'image/png',buffer:pixels});
  await v.getByRole('button',{name:'Upload for media review',exact:true}).click();await expect(v.locator('[aria-label="Private image uploads"]').getByRole('status')).toContainText('ATI must review');
  await expect(v.locator('.media-review img')).toHaveCount(2);
  await v.getByRole('button',{name:'Use local supplier sample',exact:true}).click();await v.getByLabel('URL demo failure scenario',{exact:true}).selectOption('1');await v.getByRole('button',{name:'Queue URL import',exact:true}).click();await expect(v.locator('[aria-label="URL image import"]').getByRole('status')).toContainText('URL import queued');
  await expect.poll(async()=>{const refresh=v.getByRole("button",{name:"Refresh URL jobs",exact:true});await refresh.click();await expect(refresh).toBeEnabled();return v.getByRole('group',{name:'URL job demo://supplier/front.png',exact:true}).textContent();},{timeout:30000}).toContain("SUCCEEDED");
  await expect(v.getByRole('group',{name:'URL job demo://supplier/front.png',exact:true})).toContainText('2 attempts');await expect(v.locator('.media-review img')).toHaveCount(3);
  await v.getByLabel('Image decision / correction reason').fill('URL source checked; retain lineage but use other images');await v.getByRole('button',{name:'Remove image 3',exact:true}).click();await expect(v.locator('.media-review img')).toHaveCount(2);
  await v.getByLabel('Image decision / correction reason').fill('Show the new image first');await v.getByRole('button',{name:'Move image 2 earlier',exact:true}).click();
  await expect(v.locator('.media-review img').first()).toHaveAttribute('src',/\/api\/v1\/catalog\/media\//);
  await v.getByRole('button',{name:'Submit saved version for review',exact:true}).click();await expect(v.locator('.detail-heading')).toContainText('in review');await expect(v.getByRole('button',{name:'Approve product',exact:true})).toHaveCount(0);
  await login(a,'admin@ati.demo');await a.goto('/operator/catalog/items/e2e_catalog_draft');
  await a.getByLabel('Image decision / correction reason').fill('Please replace this image with the corrected background');await a.getByRole('button',{name:'Reject image 1',exact:true}).click();await expect(a.locator('.detail-heading')).toContainText('changes requested');
  await v.reload();await expect(v.getByRole('group',{name:'Image 1',exact:true})).toContainText('corrected background');
  await v.getByLabel('Image decision / correction reason').fill('Replace rejected image with corrected background');await v.getByRole('button',{name:'Replace image 1',exact:true}).click();
  const originalImage=await v.locator('.media-review img').first().getAttribute('src');
  await v.getByLabel('Replacement file for image 1',{exact:true}).setInputFiles({name:'corrupt.png',mimeType:'image/png',buffer:Buffer.from('not pixels')});await v.getByRole('button',{name:'Save replacement for image 1',exact:true}).click();
  await expect(v.getByRole('group',{name:'Replacement for image 1',exact:true}).getByRole('alert')).toBeVisible();await expect(v.locator('.media-review img').first()).toHaveAttribute('src',originalImage!);await expect(v.locator('.media-review img')).toHaveCount(2);
  const replacement=await sharp({create:{width:256,height:256,channels:3,background:'#ffffff'}}).png().toBuffer();
  await v.getByLabel('Replacement file for image 1',{exact:true}).setInputFiles({name:'corrected.png',mimeType:'image/png',buffer:replacement});await v.getByRole('button',{name:'Save replacement for image 1',exact:true}).click();
  await expect(v.locator('.media-review img').first()).not.toHaveAttribute('src',originalImage!);await expect(v.getByRole('group',{name:'Image 1',exact:true}).locator('.badge')).toHaveText('pending');await expect(v.locator('.media-review img')).toHaveCount(2);
  const archive=Buffer.from(zipParts(new Map<string,string|Buffer>([['corrected.png',replacement],['manifest.json',JSON.stringify({version:1,images:[{file:'corrected.png'}]})]])),'base64');
  await v.getByLabel('Choose image ZIP',{exact:true}).setInputFiles({name:'corrected-images.zip',mimeType:'application/zip',buffer:archive});await v.getByRole('button',{name:'Queue ZIP import',exact:true}).click();await expect(v.locator('[aria-label="ZIP image import"]').getByRole('status')).toContainText('ZIP queued privately');
  await expect.poll(async()=>{const refresh=v.getByRole("button",{name:"Refresh ZIP jobs",exact:true});await refresh.click();await expect(refresh).toBeEnabled();return v.getByRole('group',{name:'ZIP job corrected-images.zip',exact:true}).textContent();},{timeout:30000}).toContain("SUCCEEDED");
  await expect(v.getByRole('group',{name:'ZIP job corrected-images.zip',exact:true})).toContainText('1 image receipts');await expect(v.locator('.media-review img')).toHaveCount(2);
  await expect(v.locator('.media-review img').first()).toHaveAttribute('src',/\/api\/v1\/catalog\/media\//);
  await v.getByRole('button',{name:'Submit saved version for review',exact:true}).click();await expect(v.locator('.detail-heading')).toContainText('in review');
  await a.reload();await a.getByLabel('Image decision / correction reason').fill('Corrected image checked and accepted');await a.getByRole('button',{name:'Approve image 1',exact:true}).click();await expect(a.getByRole('group',{name:'Image 1',exact:true}).locator('.badge')).toHaveText('approved');
  await a.getByLabel('Review evidence / feedback').fill('Browser acceptance: reviewed bilingual content, rights and uploaded pixels.');await a.getByRole('button',{name:'Approve product',exact:true}).click();await a.getByRole('button',{name:'Publish through ERP',exact:true}).click();
  await expect.poll(async()=>{const refresh=a.getByRole("button",{name:"Refresh status",exact:true});await refresh.click();await expect(refresh).toBeEnabled();return a.locator('.detail-heading').textContent();},{timeout:30000}).toContain("published");
  await expect(a.locator('.publication-flow .badge')).toHaveText(['succeeded','succeeded','succeeded']);await a.getByRole('button',{name:'Check storefront',exact:true}).click();await expect(a.locator('.storefront-evidence .quality-clear')).toContainText('Verified');await expect(a.locator('.storefront-preview')).toContainText('Browser verified silk dress');
  await expect(a.locator('.storefront-photo img')).toHaveAttribute('src',/\/api\/v1\/catalog\/media\//);await expect(a.locator('.storefront-photo img')).toHaveJSProperty('naturalWidth',256);
  const evidence=await (await a.request.get('/api/v1/catalog/items/e2e_catalog_draft')).json();expect(evidence.status).toBe('PUBLISHED');expect(evidence.publications.every((p:{externalId:string})=>p.externalId&&!p.externalId.startsWith('seed-'))).toBe(true);
  await v.reload();await expect(v.locator('.detail-heading')).toContainText('published');await expect(v.getByLabel('English title',{exact:true})).toBeDisabled();
  await a.screenshot({path:test.info().outputPath('catalogue-publication.png'),fullPage:true});
 }finally{await vendor.close();await operator.close();}
});
