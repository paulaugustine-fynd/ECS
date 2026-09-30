import {test,expect} from '@playwright/test';
import {coachSteps} from '../../packages/simulation/coach-catalog';
import {signIn} from './auth';

test('Coach journey crosses separate partner and ATI pages, recovers failure, and completes all requirement steps',async({page})=>{
 test.setTimeout(240000);await signIn(page,'admin@ati.demo');await page.goto('/operator/coach');
 await expect(page.getByRole('button',{name:'Start Coach UAE journey'})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('coach-start.png'),fullPage:true});
 await page.getByRole('button',{name:'Start Coach UAE journey'}).click();
 await expect(page).toHaveURL(/\/operator\/coach\/[a-f0-9-]+$/);
 for(const step of coachSteps){
  const handoff=page.getByRole('link',{name:step.page==='partner'?'Open Coach partner page':'Open ATI review page',exact:true});
  if(await handoff.isVisible())await handoff.click();
  await expect(page.getByRole('heading',{name:step.title,exact:true})).toBeVisible();
  await expect(page).toHaveURL(step.page==='partner'?/\/onboarding\/coach\//:/\/operator\/coach\//);
  if(step.id==='apply'){
   await page.screenshot({path:test.info().outputPath('coach-onboarding.png'),fullPage:true});
   await page.getByRole('button',{name:'العربية',exact:true}).click();
   await expect(page.getByRole('heading',{name:'أكمل طلب شراكة Coach الإمارات'})).toBeVisible();
   await page.getByRole('button',{name:'English',exact:true}).click();
  }
  if(step.id==='publish'){
   await page.getByText('Try a failed update',{exact:true}).click();
   await page.getByRole('button',{name:'Simulate an unavailable service'}).click();
   await expect(page.getByRole('status')).toContainText('Nothing was changed');
   await page.reload();
   await page.getByRole('button',{name:'Try this update again'}).click();
  }else{
   if(step.id==='order'){
    await page.getByLabel('Coach bag quantity',{exact:true}).fill('99');
    await page.getByRole('button',{name:step.action,exact:true}).click();
    await expect(page.locator('.coach-warning[role="alert"]')).toContainText('not enough available stock');
    await page.getByLabel('Coach bag quantity',{exact:true}).fill('2');
   }
   if(step.id==='collection'){
    await page.getByLabel('Customer collection code').fill('0000');
    await page.getByRole('button',{name:step.action,exact:true}).click();
    await expect(page.locator('.coach-warning[role="alert"]')).toContainText('not been handed over');
    await page.getByLabel('Customer collection code').fill('4826');
   }
   if(step.id==='activate')await page.screenshot({path:test.info().outputPath('coach-readiness.png'),fullPage:true});
   await page.getByRole('button',{name:step.action,exact:true}).click();
  }
  await expect(page.getByRole('status')).toContainText(step.result);
 }
 await expect(page.getByRole('heading',{name:'Coach UAE’s journey is complete.'})).toBeVisible();
 await page.getByRole('button',{name:'Workbook checklist',exact:true}).click();
 await expect(page.locator('.coach-coverage article')).toHaveCount(54);
 await expect(page.getByText('Still to demonstrate',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Saved business records',exact:true}).click();
 await expect(page.locator('.coach-statement')).toContainText('2,670.00');
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download statement entries'}).click()]);
 expect(download.suggestedFilename()).toBe('COACH-DEMO-statement.csv');
 await page.reload();await page.getByRole('button',{name:'Saved business records',exact:true}).click();
 await expect(page.locator('.coach-statement')).toContainText('Locked statement');
 await page.screenshot({path:test.info().outputPath('coach-results.png'),fullPage:true});
});

test('Coach journey is usable on a narrow screen and walkthrough downloads',async({page})=>{
 await page.setViewportSize({width:390,height:844});await signIn(page,'ops@ati.demo');await page.goto('/operator/coach');
 await page.getByRole('button',{name:'Start Coach UAE journey'}).click();await expect(page.getByRole('heading',{name:'Invite Coach UAE',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Create sample invitation',exact:true}).click();await page.getByRole('link',{name:'Open Coach partner page',exact:true}).click();
 await expect(page.getByLabel('Business name',{exact:true})).toBeVisible();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download walkthrough',exact:true}).click()]);expect(download.suggestedFilename()).toBe('Coach-UAE-demo-workflow.txt');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.screenshot({path:test.info().outputPath('coach-mobile.png'),fullPage:true});
});
