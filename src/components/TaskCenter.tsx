import React,{useEffect,useState}from'react';
import{CheckCircle2,ChevronDown,ChevronUp,Loader2,Server,XCircle}from'lucide-react';

type Job={jobId:string;status:string;command:string;createdAt:number;finishedAt?:number;error?:string;results?:any[];proChart?:any;paperExecution?:any};

export default function TaskCenter(){
  const[jobs,setJobs]=useState<Job[]>([]);
  const[open,setOpen]=useState(false);
  const[selected,setSelected]=useState<string|null>(null);

  const refresh=async()=>{
    try{
      const r=await fetch('/api/agents/jobs?limit=10',{cache:'no-store'});
      const d=await r.json();
      if(r.ok&&d.ok&&Array.isArray(d.jobs))setJobs(d.jobs);
    }catch{}
  };

  useEffect(()=>{refresh();const t=setInterval(refresh,1500);return()=>clearInterval(t)},[]);
  const active=jobs.filter(j=>j.status==='pending'||j.status==='running');
  const job=jobs.find(j=>j.jobId===selected)||jobs[0];

  return <div className="mb-6 bg-gray-900/80 border border-gray-800 rounded-xl overflow-hidden">
    <button onClick={()=>setOpen(v=>!v)} className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-800/40">
      <div className="flex items-center gap-3">
        <Server className="w-4 h-4 text-cyan-400"/>
        <div>
          <p className="text-white text-sm font-medium">Server Tasks</p>
          <p className="text-gray-500 text-[11px]">Persisted VPS jobs · {active.length} active · {jobs.length} recent</p>
        </div>
      </div>
      {open?<ChevronUp className="w-4 h-4 text-gray-500"/>:<ChevronDown className="w-4 h-4 text-gray-500"/>}
    </button>

    {open&&<div className="border-t border-gray-800 grid grid-cols-1 xl:grid-cols-3">
      <div className="border-r border-gray-800 max-h-[320px] overflow-y-auto">
        {jobs.map(j=><button key={j.jobId} onClick={()=>setSelected(j.jobId)}
          className={'w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/40 '+(job?.jobId===j.jobId?'bg-gray-800/50':'')}>
          <div className="flex items-center gap-2">
            {(j.status==='pending'||j.status==='running')&&<Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400"/>}
            {j.status==='done'&&<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400"/>}
            {j.status==='error'&&<XCircle className="w-3.5 h-3.5 text-red-400"/>}
            <span className="text-[10px] uppercase text-gray-500">{j.status}</span>
          </div>
          <p className="text-gray-300 text-xs mt-1 line-clamp-2">{j.command}</p>
          <p className="text-gray-600 text-[10px] mt-1">{new Date(j.createdAt).toLocaleString()}</p>
        </button>)}
        {!jobs.length&&<p className="p-4 text-xs text-gray-500">No server jobs yet.</p>}
      </div>

      <div className="xl:col-span-2 p-4 max-h-[320px] overflow-y-auto">
        {job&&<div className="space-y-3">
          <div>
            <p className="text-gray-500 text-[10px]">{job.jobId}</p>
            <p className="text-white text-sm mt-1">{job.command}</p>
          </div>
          {job.error&&<div className="bg-red-500/10 border border-red-500/20 rounded p-3 text-xs text-red-300">{job.error}</div>}
          {(job.results||[]).map((r:any,i:number)=><div key={i} className={'rounded-lg border p-3 '+(r.ok?'bg-gray-950/50 border-gray-800':'bg-red-500/5 border-red-500/20')}>
            <div className="flex justify-between gap-2 flex-wrap">
              <p className="text-white text-xs font-medium">{r.role||'AI role'}</p>
              <p className="text-gray-500 text-[10px]">preferred {r.preferredProvider||r.provider} · actual {r.provider||'none'} · {r.model||'no model'}{r.latencyMs?' · '+r.latencyMs+' ms':''}</p>
            </div>
            {Array.isArray(r.attempts)&&<p className="text-gray-500 text-[10px] mt-1">{r.attempts.map((a:any)=>a.provider+': '+(a.ok?'response':'failed')).join(' · ')}</p>}
            <p className="text-gray-300 text-xs whitespace-pre-wrap mt-2">{r.ok?r.content:(r.error||'Provider failed')}</p>
          </div>)}
          {job.proChart&&<div className="bg-gray-950/50 border border-gray-800 rounded p-3 text-xs text-gray-300">
            ProChart: {(job.proChart.actions||[]).map((a:any)=>a.action+' '+(a.ok?'OK':'FAILED')).join(' · ')}
          </div>}
          {job.paperExecution&&<div className="bg-gray-950/50 border border-gray-800 rounded p-3 text-xs text-gray-300">
            PAPER: {job.paperExecution.ok?'persisted simulated execution completed':'rejected: '+job.paperExecution.error}
          </div>}
        </div>}
      </div>
    </div>}
  </div>
}
