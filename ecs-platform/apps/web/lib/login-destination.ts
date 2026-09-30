/** Keep redirects on known local workspaces; never accept an external URL. */
export function loginDestination(vendor:boolean,desired:string|null){
 if(vendor)return desired==='/onboarding'?desired:'/vendor/dashboard';
 if(desired&&/^\/operator\/[a-zA-Z0-9/-]+$/.test(desired)&&!desired.includes('//'))return desired;
 if(desired&&/^\/onboarding\/coach\/[a-f0-9-]{36}$/.test(desired))return desired;
 return '/operator/dashboard';
}
