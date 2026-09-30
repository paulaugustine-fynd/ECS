/** Keep redirects on known local workspaces; never accept an external URL. */
export function loginDestination(vendor:boolean,desired:string|null){
 if(vendor)return desired==='/onboarding'?desired:'/vendor/dashboard';
 if(desired&&/^\/operator\/[a-zA-Z0-9/-]+$/.test(desired)&&!desired.includes('//'))return desired;

 return '/operator/dashboard';
}
