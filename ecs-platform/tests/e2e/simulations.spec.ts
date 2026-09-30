import {test,expect} from '@playwright/test';
import {signIn} from './auth';

test('simulation studio persists failure/replay, exact finance and download evidence',async({page})=>{
 await signIn(page,'admin@ati.demo');await page.goto('/operator/simulations');
 await expect(page.getByRole('heading',{name:'Every handoff. Every “what if”.'})).toBeVisible();
 await expect(page.locator('.sim-card')).toHaveCount(18);
 await page.getByRole('link',{name:/Tax, FX & settlement reconciliation/}).click();
 await page.getByLabel('Item price (local currency)',{exact:true}).fill('1050');
 await page.getByLabel('Brand-funded discount (%)',{exact:true}).fill('0');
 await page.getByLabel('Received FX to AED',{exact:true}).fill('1.01');
 await page.getByRole('button',{name:'Start simulation',exact:true}).click();
 await expect(page.locator('.sim-run-bar')).toContainText('RUNNING');
 await page.getByRole('button',{name:'Fail next handoff',exact:true}).click();
 await expect(page.locator('.sim-run-bar')).toContainText('DEAD LETTER');
 await expect(page.locator('.sim-message.failed')).toHaveCount(1);
 await page.reload();await expect(page.locator('.sim-run-bar')).toContainText('DEAD LETTER');
 await page.getByRole('button',{name:'Replay failed handoff',exact:true}).click();
 await expect(page.locator('.sim-run-bar')).toContainText('RUNNING');
 await page.getByRole('button',{name:'Run remaining steps',exact:true}).click();
 await expect(page.locator('.sim-run-bar')).toContainText('COMPLETED');
 await page.getByRole('tab',{name:'Outcomes',exact:true}).click();
 await expect(page.locator('.sim-tab-panel')).toContainText('VARIANCE_RESOLVED');
 await expect(page.locator('.sim-tab-panel')).toContainText('700.00');
 await page.getByRole('button',{name:'Replay duplicate',exact:true}).click();
 await expect(page.locator('.sim-trace')).toContainText('DUPLICATE IGNORED');
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export run evidence',exact:true}).click()]);
 expect(download.suggestedFilename()).toContain('SIMULATION-finance-cycle');
 await page.getByRole('tab',{name:'Outcomes',exact:true}).click();
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:test.info().outputPath('simulation-finance.png'),fullPage:true});
 await page.getByRole('link',{name:'All scenarios',exact:true}).click();
 await expect(page.locator('.sim-hero-stats')).toContainText('1 of 18');
});

test('missing-capability scenarios complete and policy inputs change the simulated outcome',async({page})=>{
 test.setTimeout(120000);await signIn(page,'ops@ati.demo');
 for(const [scenario,label,value,result] of [
  ['trusted-approval','Restricted category','true','MANUAL_REVIEW'],
  ['return-journey','QC outcome','BAD','QC_HOLD'],
  ['fulfilment','Collection code (fixture: 4826)','0000','REJECTED_WRONG_CODE'],
  ['warehouse','','','RETURN_COLLECTION'],
  ['translation','','','ACKNOWLEDGED'],
  ['media-studio','Creative-use consent','false','No'],
 ]){
  await page.goto(`/operator/simulations/${scenario}`);
  if(label){if(value==='0000')await page.getByLabel(label,{exact:true}).fill(value);else await page.getByRole('combobox',{name:label,exact:true}).selectOption(value,{timeout:10000});}
  await page.getByRole('button',{name:'Start simulation',exact:true}).click();
  await expect(page.locator('.sim-run-bar')).toContainText('RUNNING');
  await page.getByRole('button',{name:'Run remaining steps',exact:true}).click();
  await expect(page.locator('.sim-run-bar')).toContainText('COMPLETED');
  await page.getByRole('tab',{name:'Outcomes',exact:true}).click();
  if(scenario==='trusted-approval')await expect(page.locator('.sim-tab-panel')).toContainText('MANUAL_REVIEW');
  else await expect(page.locator('.sim-tab-panel')).toContainText(result);
 }
 await page.setViewportSize({width:390,height:844});
 await page.goto('/operator/simulations/warehouse');
 await expect(page.getByRole('heading',{name:'Warehouse appointments & purchase orders',exact:true})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('simulation-mobile.png'),fullPage:true});
});
