'use client';
import {useEffect} from 'react';
export function DemoHeartbeat(){
 useEffect(()=>{let stopped=false,busy=false;
  const tick=async()=>{if(stopped||busy||document.visibilityState!=='visible')return;busy=true;try{await fetch('/api/v1/auth/me',{credentials:'same-origin',cache:'no-store'});}catch{/* Durable work retries on the next connected request. */}finally{busy=false;}};
  const timer=setInterval(()=>{void tick();},15000);
  return()=>{stopped=true;clearInterval(timer);};
 },[]);
 return null;
}
