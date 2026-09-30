'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { api,type User } from '../../lib/api';
import {loginDestination} from '../../lib/login-destination';
export default function Login(){
  const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <main className="login"><Link href="/" className="back"><ArrowLeft size={16}/> Back to ECS</Link><img src="/brand/bloomingdales-wordmark.svg" alt="Bloomingdale’s"/>
  <div className="login-box"><span className="eyebrow">EXTERNAL CONCESSIONS</span><h1>Welcome back</h1><p>Sign in to your secure partner or ATI workspace.</p>
  <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const {user}=await api<{user:User}>('/auth/login',{email,password});const desired=new URLSearchParams(location.search).get('next');location.href=loginDestination(user.role.startsWith('VENDOR_'),desired);}catch(err){setError((err as Error).message);setBusy(false);}}}>
    <label>Email<input name="email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error&&<div role="alert" className="error">{error}</div>}<button className="primary black" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
  </form><div className="security-note"><LockKeyhole size={15}/> Authenticated access · Partner-isolated records</div></div>
  <details className="demo-accounts"><summary>Fictional demonstration accounts</summary><p>Password for fictional demo users: <code>Demo123!</code></p>{['admin@ati.demo','partner.manager@ati.demo','catalog@ati.demo','ops@ati.demo','finance@ati.demo','admin@maisonazure.demo','fulfilment@maisonazure.demo','catalog@lumera.demo','admin@ateliernoor.demo'].map(a=><button key={a} onClick={()=>{setEmail(a);setPassword('Demo123!');}}>{a}</button>)}</details>
  </main>;
}
