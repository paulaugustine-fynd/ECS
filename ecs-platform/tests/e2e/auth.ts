import {expect,type Page} from '@playwright/test';

// Full-suite personas share one loopback IP. Honour the real authentication
// throttle rather than disabling it, fabricating cookies or masking 401s.
export async function signIn(page:Page,email:string){
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Demo123!');
 for(let attempt=0;attempt<3;attempt++){
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/login')&&r.request().method()==='POST'),page.getByRole('button',{name:'Sign in',exact:true}).click()]);
  if(response.status()!==429){expect(response.status(),'Login response status').toBe(200);break;}
  const seconds=Number(response.headers()['retry-after']);
  expect(Number.isFinite(seconds)&&seconds>0&&seconds<=30,'Bounded server-directed login retry').toBe(true);expect(attempt,'Login still throttled after bounded retries').toBeLessThan(2);
  await new Promise(resolve=>setTimeout(resolve,seconds*1000+100));
 }
 await expect(page).toHaveURL(email.endsWith('@ati.demo')?/\/operator\/dashboard$/:/\/vendor\/dashboard$/);
}
