const msg = document.querySelector("#adminMessage");
const form = document.querySelector("#adminLogin");
const area = document.querySelector("#adminArea");
function say(t, bad=false) { msg.textContent=t; msg.className="message "+(bad?"error":"success"); }
async function api(url, options={}) {
 const r=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
 const d=await r.json().catch(()=>({}));
 if(!r.ok) throw new Error(d.error||"Request failed.");
 return d;
}
form.addEventListener("submit", async e=>{
 e.preventDefault();
 try { const data=Object.fromEntries(new FormData(form)); await api("/api/admin/login",{method:"POST",body:JSON.stringify(data)}); form.classList.add("hidden"); area.classList.remove("hidden"); say("Admin login successful."); await refresh(); }
 catch(err){say(err.message,true);}
});
async function refresh(){
 try {
  const d=await api("/api/admin/customers");
  document.querySelector("#summary").innerHTML=`<div class="stat"><b>${d.summary.total}</b><span>Total</span></div><div class="stat"><b>${d.summary.pending}</b><span>Pending</span></div><div class="stat"><b>${d.summary.approved}</b><span>Approved</span></div><div class="stat"><b>${d.summary.rejected}</b><span>Rejected</span></div>`;
  const tbody=document.querySelector("#customers"); tbody.replaceChildren();
  d.customers.forEach(c=>{
   const tr=document.createElement("tr");
   const values=[c.id,c.name,c.username,c.status,c.credits];
   values.forEach(v=>{const td=document.createElement("td");td.textContent=String(v);tr.appendChild(td);});
   const td=document.createElement("td");
   const status=document.createElement("select");
   ["pending","approved","rejected","disabled"].forEach(s=>{const o=document.createElement("option");o.value=s;o.textContent=s;o.selected=s===c.status;status.appendChild(o);});
   const save=document.createElement("button");save.textContent="Save status";save.className="small";
   save.onclick=async()=>{try{await api(`/api/admin/customers/${c.id}`,{method:"PATCH",body:JSON.stringify({status:status.value})});say("Status updated.");await refresh();}catch(e){say(e.message,true);}};
   const credits=document.createElement("input");credits.type="number";credits.min="0";credits.max="100000000";credits.value=c.credits;credits.className="credit-input";credits.setAttribute("aria-label","Credits");
   const saveCredits=document.createElement("button");saveCredits.textContent="Save credits";saveCredits.className="small";
   saveCredits.onclick=async()=>{try{await api(`/api/admin/customers/${c.id}/credits`,{method:"PATCH",body:JSON.stringify({credits:Number(credits.value)})});say("Credits updated.");await refresh();}catch(e){say(e.message,true);}};
   td.append(status,save,credits,saveCredits);tr.appendChild(td);tbody.appendChild(tr);
  });
 } catch(e) { say(e.message,true); }
}
document.querySelector("#adminLogout").addEventListener("click",async()=>{try{await api("/api/admin/logout",{method:"POST",body:"{}"});}catch{} location.reload();});
