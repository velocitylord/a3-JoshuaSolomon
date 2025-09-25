const serviceSelect = document.getElementById('serviceSelect');
const ticketsTbody  = document.querySelector('#ticketsTable tbody');
const tipInput      = document.getElementById('tipInput');
const addBtn        = document.getElementById('addBtn');
const whoamiEl      = document.getElementById('whoami');
const logoutBtn     = document.getElementById('logoutBtn');

function money(n){ return `$${Number(n).toFixed(2)}`; }
function min(n){ return `${n} min`; }

async function loadMe(){
  const r = await fetch('/me');
  if (r.status === 401) { window.location = '/login.html'; return; }
  const j = await r.json().catch(()=>({}));
  if (j.username) whoamiEl.textContent = `Signed in as ${j.username}`;
}

async function loadCatalog(){
  const r = await fetch('/catalog');
  if (!r.ok) { window.location = '/login.html'; return; }
  const services = await r.json();
  serviceSelect.innerHTML = services.map(
    s => `<option value="${s.id}">${s.type} — $${s.regularPrice}</option>`
  ).join('');
}

function rowHtml(row){
  return `<tr data-id="${row._id}">
    <td>${row.service}</td>
    <td>${money(row.price)}</td>
    <td>${money(row.tax)}</td>
    <td>
      <input class="form-control form-control-sm tipEdit" type="number" step="0.01" value="${Number(row.tip).toFixed(2)}" style="max-width:90px;">
      <button class="btn btn-sm btn-outline-primary mt-1 updateBtn">Update</button>
    </td>
    <td>${money(row.total)}</td>
    <td>${min(row.duration)}</td>
    <td><button class="btn btn-sm btn-outline-danger deleteBtn">Delete</button></td>
  </tr>`;
}

async function loadData(){
  const r = await fetch('/data');
  if (!r.ok) return; 
  const rows = await r.json();
  ticketsTbody.innerHTML = rows.map(rowHtml).join('');
}

addBtn.addEventListener('click', async () => {
  const serviceid = serviceSelect.value;
  const tip = tipInput.value || '';
  const r = await fetch('/submit', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ serviceid, tip })
  });
  if (!r.ok) {
    const err = await r.json().catch(()=>({error:'error'}));
    alert(err.error || 'Add failed');
    if (r.status === 401) window.location = '/login.html';
    return;
  }
  tipInput.value = '';
  await loadData();
});

ticketsTbody.addEventListener('click', async (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const id = tr.getAttribute('data-id');

  if (e.target.classList.contains('updateBtn')) {
    const tip = tr.querySelector('.tipEdit').value;
    const r = await fetch('/update', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, tip })
    });
    if (!r.ok) {
      const err = await r.json().catch(()=>({error:'error'}));
      alert(err.error || 'Update failed');
      if (r.status === 401) window.location = '/login.html';
    }
    await loadData();
    return;
  }

  if (e.target.classList.contains('deleteBtn')) {
    const r = await fetch('/delete', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id })
    });
    if (!r.ok) {
      const err = await r.json().catch(()=>({error:'error'}));
      alert(err.error || 'Delete failed');
      if (r.status === 401) window.location = '/login.html';
    }
    await loadData();
    return;
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/logout', { method:'POST' }).catch(()=>{}); // clear cookies on the server
  window.location = '/login.html';
});

(async function init(){
  await loadMe();       
  await loadCatalog();  
  await loadData();     
})();

