'use strict';
'require view';
'require rpc';
'require poll';

// Copyright (c) 2026 Prateek Agrawal, MIT License
// https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras

// Guest Wi-Fi, one QR per guest. Backend: /usr/bin/guestwifi.sh via rpcd "guestwifi".
// Two page styles (Wallet / Dashboard), chosen in Settings and saved on the router
// (uci guestwifi.ui.view).

const callStatus = rpc.declare({ object: 'guestwifi', method: 'status' });
const callPower = rpc.declare({ object: 'guestwifi', method: 'power', params: [ 'on' ] });
const callCreate = rpc.declare({ object: 'guestwifi', method: 'create', params: [ 'time', 'data', 'speed', 'devs', 'label' ] });
const callEdit = rpc.declare({ object: 'guestwifi', method: 'edit', params: [ 'id', 'time', 'data', 'speed', 'devs', 'label' ] });
const callId = m => rpc.declare({ object: 'guestwifi', method: m, params: [ 'id' ] });
const CALL = { cancel: callId('cancel'), revoke: callId('revoke'), extend: callId('extend'), unlock: callId('unlock') };
const callClear = rpc.declare({ object: 'guestwifi', method: 'clear' });
const callView = rpc.declare({ object: 'guestwifi', method: 'setview', params: [ 'view' ] });

const MB = 1048576;
const OPT = {
	time: [ [ 30, '30 min' ], [ 60, '1 hour' ], [ 120, '2 hours' ], [ 180, '3 hours' ], [ 360, '6 hours' ], [ 1440, '1 day' ] ],
	data: [ [ 200, '200 MB' ], [ 500, '500 MB' ], [ 1024, '1 GB' ], [ 2048, '2 GB' ], [ 0, 'No limit' ] ],
	speed: [ [ 5, '5 Mbps' ], [ 10, '10 Mbps' ], [ 20, '20 Mbps' ], [ 30, '30 Mbps' ] ],
	devs: [ [ 1, '1 phone' ], [ 2, '2' ], [ 3, '3 (family)' ], [ 5, '5' ] ],
};
const WHY = { revoked: 'Revoked', time: 'Time over', data: 'Data limit' };
const COLORS = [ '#ff9500', '#5856d6', '#ff2d55', '#30b0c7', '#34c759', '#af52de', '#007aff', '#a2845e' ];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtPin = k => k.slice(0, 4) + ' ' + k.slice(4);
const dur = m => { m = Math.max(0, Math.round(m)); return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + 'm'; };
const fmtB = b => b >= 1073741824 ? (b / 1073741824).toFixed(2).replace(/\.?0+$/, '') + ' GB' : Math.round(b / MB) + ' MB';
const fmtMB = v => v ? (v >= 1024 ? (v / 1024).toFixed(v % 1024 ? 1 : 0) + ' GB' : v + ' MB') : '∞';
const color = p => COLORS[(p.id - 1) % COLORS.length];

const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.1-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';

function wifiQR(ssid, key) {
	const e = s => s.replace(/([\\;,:"])/g, '\\$1');
	return `WIFI:T:WPA;S:${e(ssid)};P:${e(key)};;`;
}

function loadQRLib() {
	return new Promise(resolve => {
		if (window.qrcode) return resolve();
		const s = document.createElement('script');
		s.src = L.resource('guestwifi/qrcode.min.js');
		s.onload = s.onerror = () => resolve();
		document.head.appendChild(s);
	});
}

// Inter comes in through a <link>, not an @import in CSS (see README: with @import the page flashed unstyled)
if (!document.getElementById('inter-font'))
	document.head.appendChild(E('link', { id: 'inter-font', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap' }));

const CSS = `
.gp{
 --bg:#f2f2f7;--card:#fff;--label:#000;--label2:#6e6e73;--label3:#aeaeb2;--sep:rgba(60,60,67,.22);
 --fill:rgba(120,120,128,.16);--fill2:rgba(120,120,128,.1);--dim:rgba(0,0,0,.32);
 --blue:#007aff;--blueText:#0066cc;--green:#34c759;--greenText:#248a3d;--red:#ff3b30;--redText:#d70015;--orange:#ff9500;--orangeText:#c93400;
 background:var(--bg);color:var(--label);border-radius:18px;padding:12px 18px 40px;margin:8px auto 24px;max-width:640px;
 font:15px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-align:left
}
:root[data-darkmode="true"] .gp{
 --bg:#000;--card:#1c1c1e;--label:#fff;--label2:#98989f;--label3:#636366;--sep:rgba(84,84,88,.6);
 --fill:rgba(120,120,128,.36);--fill2:rgba(120,120,128,.22);--dim:rgba(0,0,0,.6);
 --blue:#0a84ff;--blueText:#409cff;--green:#30d158;--greenText:#30d158;--red:#ff453a;--redText:#ff6961;--orange:#ff9f0a;--orangeText:#ff9f0a
}
.gp *{box-sizing:border-box}
.gp button{font:inherit;color:inherit;margin:0}
.gp .lt{font-size:30px;font-weight:700;letter-spacing:-.02em;margin:4px 4px 2px}
.gp .hdr{display:flex;align-items:center;justify-content:space-between;gap:8px}
.gp .hbtns{display:flex;align-items:center;gap:10px}
.gp .capline{color:var(--label2);font-size:13px;margin:0 4px 14px}
.gp .sw{position:relative;width:51px;height:31px;border-radius:16px;border:0;background:var(--fill);cursor:pointer;flex:none;transition:background .2s;padding:0}
.gp .sw::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.2);transition:transform .2s}
.gp .sw[aria-checked=true]{background:var(--green)}.gp .sw[aria-checked=true]::after{transform:translateX(20px)}
.gp .gear{width:34px;height:34px;border-radius:50%;border:0;background:var(--fill2);font-size:18px;cursor:pointer;display:grid;place-items:center;color:var(--label2);padding:0}
.gp .btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;border:0;border-radius:12px;padding:12px;font-weight:600;cursor:pointer;background:var(--blue);color:#fff}
.gp .btn.sec{background:var(--fill);color:var(--blueText)}
.gp .btn.red{background:var(--fill);color:var(--redText)}
.gp .btn:active,.gp .mini:active{opacity:.7}
.gp .btns{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px;margin-top:12px}
.gp .btns .btn{padding:10px 6px;font-size:14px}
.gp .sect{font-size:13px;font-weight:600;color:var(--label2);text-transform:uppercase;letter-spacing:.05em;margin:22px 8px 8px;display:flex;justify-content:space-between}
.gp .sect a{text-transform:none;letter-spacing:0;color:var(--blueText);cursor:pointer;font-weight:500}
.gp .empty{padding:16px;color:var(--label2);font-size:14px;text-align:center;background:var(--card);border-radius:14px}
.gp .mono{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.gp .qr{background:#fff;border-radius:12px;padding:8px;display:grid;place-items:center;color:#000;font-size:11px}
.gp .qr svg{width:100%;height:100%;display:block}
.gp .tag{display:inline-block;font-size:10.5px;font-weight:700;border-radius:5px;padding:1px 5px;background:var(--fill);color:var(--label2);vertical-align:1px}
.gp .tag.on{background:color-mix(in srgb,var(--green) 20%,transparent);color:var(--greenText)}
.gp .bar{height:6px;border-radius:3px;background:var(--fill);overflow:hidden}.gp .bar i{display:block;height:100%;background:var(--green);border-radius:3px}
.gp .bar i.w{background:var(--orange)}.gp .bar i.x{background:var(--red)}
.gp .mini{border:0;background:var(--fill2);font-size:12.5px;font-weight:600;border-radius:8px;padding:6px 9px;cursor:pointer;color:var(--blueText)}
.gp .mini.r{color:var(--redText)}.gp .mini.o{color:var(--orangeText)}
.gp .st{font-size:12.5px;font-weight:600;white-space:nowrap}
.gp .st.on{color:var(--greenText)}.gp .st.off{color:var(--label2)}.gp .st.warn{color:var(--orangeText)}
.gp .pwtxt{display:inline-block;min-width:6.2ch}
.gp .eye{border:0;background:rgba(127,127,127,.18);color:inherit;width:1.25em;height:1.25em;min-width:28px;min-height:28px;border-radius:50%;display:inline-grid;place-items:center;vertical-align:middle;margin-left:8px;cursor:pointer;padding:0}
.gp .eye svg{width:60%;height:60%;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
/* wallet */
.gp .pass{position:relative;border-radius:18px;color:#fff;background:linear-gradient(160deg,#14a08a 0%,#0e737a 50%,#173f6b 100%);padding:16px 18px 18px;box-shadow:0 14px 30px rgba(0,0,0,.22)}
.gp .pass.void{background:linear-gradient(160deg,#9a9aa0,#5d5d63)}
.gp .pass small{display:block;font-size:10.5px;font-weight:600;letter-spacing:.07em;opacity:.8;text-transform:uppercase}
.gp .p-h{display:flex;align-items:center;gap:9px}
.gp .p-logo{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.2);display:grid;place-items:center}
.gp .p-org{font-weight:600;flex:1}
.gp .p-prim{margin:14px 0 12px}.gp .p-prim b{font-size:28px;font-weight:600}
.gp .p-sec{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.gp .p-sec b{font-size:14.5px;font-weight:600;white-space:nowrap}
.gp .p-perf{position:relative;border-top:1.5px dashed rgba(255,255,255,.4);margin:16px -18px 0}
.gp .p-perf::before,.gp .p-perf::after{content:"";position:absolute;top:-11px;width:22px;height:22px;border-radius:50%;background:var(--bg)}
.gp .p-perf::before{left:-11px}.gp .p-perf::after{right:-11px}
.gp .p-qr{display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:16px}
.gp .p-qr .qr{width:150px;height:150px;cursor:zoom-in}
.gp .p-qr span{font-size:13px;opacity:.92;text-align:center}
.gp .tix{display:grid;gap:10px}
.gp .tick{display:grid;grid-template-columns:8px 1fr;background:var(--card);border-radius:14px;overflow:hidden}
.gp .tick .stub{background:var(--c)}
.gp .tick .body{padding:11px 13px 12px;min-width:0}
.gp .tick .t1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.gp .tick b{font-size:15px}
.gp .tick .m{font-size:12.5px;color:var(--label2);margin:2px 0 8px}
.gp .meters{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:11.5px;color:var(--label2)}
.gp .meters span{display:flex;justify-content:space-between;margin-bottom:3px}
.gp .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.gp .ended{opacity:.6}
/* dashboard */
.gp .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.gp .stat{background:var(--card);border-radius:14px;padding:10px 12px}
.gp .stat small{font-size:11.5px;color:var(--label2);font-weight:600;display:block}
.gp .stat b{font-size:22px;font-weight:700;letter-spacing:-.02em}
.gp .stat em{font-style:normal;font-size:12px;color:var(--label2)}
.gp .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.gp .tile{border:0;box-sizing:border-box;background:var(--card);border-radius:18px;padding:13px;min-height:168px;display:flex;flex-direction:column;gap:6px;cursor:pointer;text-align:left}
.gp .tile.new{border:2px dashed var(--sep);background:transparent;align-items:center;justify-content:center;color:var(--blueText);font-weight:600;text-align:center}
.gp .tile.new .plus{font-size:40px;font-weight:300;line-height:1}
.gp .tile.open{background:linear-gradient(160deg,#14a08a,#173f6b);color:#fff;cursor:default}
.gp .tile.open .qr{width:84px;height:84px;padding:4px;border-radius:8px;cursor:zoom-in;flex:none}
.gp .tile .tt{display:flex;justify-content:space-between;align-items:center;gap:6px}
.gp .tile .tt b{font-size:14.5px}
.gp .tile small{color:var(--label2);font-size:12px}
.gp .tile.open small{color:rgba(255,255,255,.85)}
.gp .tile .big{font-size:20px;font-weight:700;letter-spacing:-.02em}
.gp .dots{display:flex;gap:3px}
.gp .dots i{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:10.5px;font-weight:700;font-style:normal}
.gp .tile .tbtns{display:flex;gap:5px;margin-top:auto}
.gp .tile .tbtns .mini{flex:1;background:rgba(255,255,255,.2);color:#fff;padding:5px 4px}
.gp .ring circle{fill:none;stroke-width:4}.gp .ring .bgc{stroke:var(--fill)}
/* overlays */
.gp .ov{position:fixed;inset:0;background:var(--dim);display:flex;align-items:flex-end;justify-content:center;z-index:1000;animation:gpfade .18s}
@keyframes gpfade{from{opacity:0}}
.gp .sheet{background:var(--bg);width:100%;max-width:560px;max-height:92vh;overflow-y:auto;border-radius:16px 16px 0 0;padding:8px 14px 22px;animation:gpup .25s cubic-bezier(.2,.8,.2,1)}
@keyframes gpup{from{transform:translateY(40%)}}
.gp .sh-h{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:6px 2px 12px}
.gp .sh-h b{font-size:17px;text-align:center}
.gp .sh-h .l{justify-self:start}.gp .sh-h .r{justify-self:end;font-weight:600}
.gp .link{border:0;background:none;color:var(--blueText);cursor:pointer;font-size:16px;padding:4px}
.gp .field{background:var(--card);border-radius:12px;padding:10px 12px;margin-bottom:10px}
.gp .field label{display:block;font-size:13px;color:var(--label2);font-weight:600;margin-bottom:7px}
.gp .opts{display:flex;flex-wrap:wrap;gap:6px}
.gp .opt{border:0;background:var(--fill2);border-radius:9px;padding:7px 11px;font-size:14px;cursor:pointer}
.gp .opt[aria-pressed=true]{background:var(--blue);color:#fff;font-weight:600}
.gp .opt:disabled{opacity:.35;cursor:default}
.gp .field input{width:100%;font:inherit;background:var(--fill2);border:0;border-radius:9px;padding:9px 10px;color:var(--label);height:auto}
.gp .note{font-size:13px;color:var(--label2);margin:4px 4px 12px}
.gp .full{position:fixed;inset:0;z-index:1001;background:linear-gradient(160deg,#14a08a 0%,#0e737a 50%,#173f6b 100%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;animation:gpfade .2s}
.gp .full .qr{width:min(300px,70vw);height:min(300px,70vw);padding:12px;border-radius:18px}
.gp .full .mono{font-size:36px;font-weight:700}
.gp .full p{margin:0;opacity:.9}
.gp .full .btn{max-width:260px;background:rgba(255,255,255,.22)}
.gp .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:1002;width:min(520px,calc(100vw - 32px));background:var(--card);border-radius:14px;padding:11px 13px;font-size:13.5px;box-shadow:0 10px 30px rgba(0,0,0,.25);border-left:4px solid var(--green);animation:gpfade .25s}
.gp .toast.bad{border-left-color:var(--red)}
.gp .det-hero{display:flex;gap:14px;align-items:center;background:var(--card);border-radius:14px;padding:14px;margin-bottom:10px}
.gp .det-hero b{font-size:18px;display:block}
.gp .kv{background:var(--card);border-radius:12px;overflow:hidden;margin-bottom:10px}
.gp .kv div{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 13px;border-top:.5px solid var(--sep);font-size:14.5px}
.gp .kv div:first-child{border-top:0}
.gp .kv span{color:var(--label2)}
.gp .dgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.gp .dgrid .mini{padding:11px;font-size:14px;border-radius:12px;background:var(--fill)}
.gp .styles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gp .style{position:relative;border:2px solid transparent;background:var(--card);border-radius:14px;padding:10px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:3px}
.gp .style.sel{border-color:var(--blue)}
.gp .style b{font-size:15px}.gp .style small{font-size:12px;color:var(--label2);line-height:1.3}
.gp .style .tickm{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:var(--blue);color:#fff;font-size:13px;font-weight:700;display:grid;place-items:center}
.gp .style:not(.sel) .tickm{background:transparent;border:1.5px solid var(--label3)}
.gp .pic{display:grid;gap:4px;background:var(--bg);border-radius:9px;padding:7px;height:104px;margin-bottom:6px;align-content:start;grid-template-columns:1fr 1fr}
.gp .pic i{display:block;border-radius:4px;background:var(--fill)}
.gp .pw-card{grid-column:1/-1;height:52px;background:linear-gradient(160deg,#14a08a,#173f6b)!important}
.gp .pw-qr{grid-column:1/-1;width:28px;height:28px;justify-self:end;margin:-44px 8px 16px 0;background:#fff!important;position:relative}
.gp .pw-line{grid-column:1/-1;height:12px}.gp .pw-line.s{width:70%}
.gp .pd-stats{grid-column:1/-1;height:14px}
.gp .pd-t{height:34px}.gp .pd-t.a{background:linear-gradient(160deg,#14a08a,#173f6b)!important}
@media (max-width:480px){.gp{padding:10px 10px 32px}.gp .p-sec{grid-template-columns:repeat(2,1fr)}.gp .stats b{font-size:18px}}
`;

return view.extend({
	load() {
		return Promise.all([ callStatus(), loadQRLib() ]);
	},

	render([ st ]) {
		this.shown = new Set();   // passwords revealed with the eye (by key)
		this.ov = null;           // { kind: 'form' | 'det' | 'full' | 'settings' | 'off', ... }
		this.last = { time: 180, data: 1024, speed: 10, devs: 1, label: '' };

		const root = this.root = document.createElement('div');
		root.className = 'gp';
		root.innerHTML = `<style>${CSS}</style><div data-r="main"></div><div data-r="layer"></div><div data-r="hud"></div>`;
		const r = this.r = {};
		root.querySelectorAll('[data-r]').forEach(el => r[el.dataset.r] = el);

		root.addEventListener('click', ev => {
			const t = ev.target.closest('[data-a]');
			if (!t || t.disabled || !root.contains(t)) return;
			if (t.hasAttribute('data-self') && ev.target !== t) return;   // clicks inside a sheet don't close it
			ev.preventDefault();
			this.act(t.dataset.a, t.dataset, t);
		});
		root.addEventListener('input', ev => { if (ev.target.dataset.k === 'label' && this.ov && this.ov.f) this.ov.f.label = ev.target.value; });
		document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && this.ov) { this.ov = null; this.draw(); } });

		this.update(st);
		poll.add(() => callStatus().then(s => this.update(s)), 3);
		return root;
	},

	update(st) {
		if (!st || !Array.isArray(st.passes)) return;
		this.st = st;
		this.st.passes.sort((a, b) => b.id - a.id);
		this.draw();
	},

	// replaces a part only when its markup changed, so polling doesn't restart animations
	put(el, html) {
		if (el._html === html) return;
		el._html = html;
		el.innerHTML = html;
	},

	draw() {
		const st = this.st;
		this.put(this.r.main, st.view === 'dashboard' ? this.dash() : this.wallet());
		// the form keeps what is being typed: it is drawn only on user actions
		if (!this.ov || this.ov.kind !== 'form' || !this.r.layer._html || !this.r.layer._html.includes('data-form'))
			this.put(this.r.layer, this.layer());
		this.put(this.r.hud, this.toastMsg ? `<div class="toast ${this.toastMsg[0]}" role="status">${esc(this.toastMsg[1])}</div>` : '');
	},

	toast(kind, msg) {
		this.toastMsg = [ kind, msg ];
		clearTimeout(this.toastT);
		this.toastT = setTimeout(() => { this.toastMsg = null; this.draw(); }, 4500);
	},

	call(p, ok) {
		return p.then(s => { if (ok) this.toast('', ok); this.update(s); })
			.catch(e => { this.toast('bad', 'The router did not answer: ' + (e.message || e)); this.draw(); });
	},

	act(a, d) {
		const st = this.st, p = d.id ? st.passes.find(x => x.id === +d.id) : null;
		switch (a) {
		case 'power':
			if (st.on && st.passes.some(x => x.state === 'a')) { this.ov = { kind: 'off' }; break; }
			return this.call(callPower(!st.on), st.on ? 'Guest Wi-Fi is off.' : 'Guest Wi-Fi is on. Tap Next guest when someone arrives.');
		case 'offyes': this.ov = null; return this.call(callPower(false), 'Guest Wi-Fi is off. All passes ended.');
		case 'settings': this.ov = { kind: 'settings' }; break;
		case 'view': return this.call(callView(d.v));
		case 'new': this.ov = { kind: 'form', f: Object.assign({}, this.last, { label: '', devs: 1 }) }; this.r.layer._html = null; break;
		case 'edit': this.ov = { kind: 'form', id: p.id, f: { time: p.time, data: p.data, speed: p.speed, devs: p.devs, label: p.label } }; this.r.layer._html = null; break;
		case 'opt': this.ov.f[d.k] = +d.v; this.r.layer._html = null; break;
		case 'save': {
			const f = this.ov.f, id = this.ov.id;
			this.ov = null;
			if (id) return this.call(callEdit(id, f.time, f.data, f.speed, f.devs, f.label.trim()), `Pass #${id} updated.`);
			this.last = Object.assign({}, f);
			return this.call(callCreate(f.time, f.data, f.speed, f.devs, f.label.trim()).then(s => {
				const c = s.passes.find(x => x.id === s.cur);
				if (c) this.ov = { kind: 'full', id: c.id };
				return s;
			}));
		}
		case 'close': this.ov = null; break;
		case 'det': this.ov = { kind: 'det', id: p.id }; break;
		case 'full': this.ov = { kind: 'full', id: p.id }; break;
		case 'eye': this.shown.has(p.key) ? this.shown.delete(p.key) : this.shown.add(p.key); if (this.ov && this.ov.kind === 'form') this.r.layer._html = null; break;
		case 'cancel': this.ov = null; return this.call(CALL.cancel(p.id), `QR #${p.id} deleted. Nobody can use it now.`);
		case 'revoke': this.ov = null; return this.call(CALL.revoke(p.id), `Pass #${p.id} revoked. Its phones are disconnected.`);
		case 'extend': return this.call(CALL.extend(p.id), `Pass #${p.id}: +1 hour.`);
		case 'unlock':
			this.ov = null;
			return this.call(CALL.unlock(p.id).then(s => { this.ov = { kind: 'full', id: p.id }; return s; }),
				`Pass #${p.id} is open for 15 min. Let the phone scan this QR again.`);
		case 'clear': return this.call(callClear());
		}
		this.draw();
	},

	/* ---------- helpers ---------- */
	pw(p) {
		const on = this.shown.has(p.key);
		return `<span class="pwtxt">${on ? fmtPin(p.key) : '•••• ••••'}</span><button class="eye" data-a="eye" data-id="${p.id}" aria-pressed="${on}" aria-label="${on ? 'Hide password' : 'Show password'}">${on ? EYE_OFF : EYE}</button>`;
	},
	qr(p, cell) {
		if (!window.qrcode) return 'QR code couldn’t load. Use the password.';
		try {
			const q = window.qrcode(0, 'M');
			q.addData(wifiQR(this.st.ssid, p.key));
			q.make();
			return q.createSvgTag({ cellSize: cell || 4, margin: 0, scalable: true });
		} catch (e) { return 'QR error'; }
	},
	isOpen(p) { return this.st.cur === p.id; },
	openLeft() { return this.st.open_min - (this.st.now - this.st.cur_opened) / 60; },
	left(p) { return p.start ? (p.start + p.time * 60 - this.st.now) / 60 : p.time; },
	online(p) { return p.devices.filter(x => x.online); },
	title(p) { return `Pass #${p.id}${p.label ? ' · ' + esc(p.label) : ''}`; },
	who(p) { return p.devices.length ? esc(p.devices.map(x => x.name || x.mac).join(', ')) : 'No phone yet'; },
	status(p) {
		if (p.state === 'e') return [ 'off', WHY[p.why] || 'Ended' ];
		if (this.isOpen(p) && !p.devices.length) return [ 'warn', `Waiting · ${dur(this.openLeft())}` ];
		if (this.isOpen(p)) return [ 'on', 'Online · QR open' ];
		const on = this.online(p).length;
		if (!on) return [ 'warn', 'Offline' ];
		return [ 'on', on < p.devices.length ? `${on}/${p.devices.length} online` : 'Online' ];
	},
	pct(p) {
		return {
			t: p.start ? Math.min(100, (this.st.now - p.start) / (p.time * 60) * 100) : 0,
			d: p.data ? Math.min(100, p.used / (p.data * MB) * 100) : 0,
		};
	},
	ring(v, size, col) {
		const r = size / 2 - 3, c = 2 * Math.PI * r, rest = Math.max(0, 100 - v), h = size / 2;
		return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="bgc" cx="${h}" cy="${h}" r="${r}"/><circle cx="${h}" cy="${h}" r="${r}" stroke="${col}" stroke-linecap="round" stroke-dasharray="${c * rest / 100} ${c}" transform="rotate(-90 ${h} ${h})"/></svg>`;
	},
	devTags(p) { return p.devices.map(x => `<span class="tag ${x.online ? 'on' : ''}">${esc(x.name || x.mac)}${x.online ? ' · ' + (x.band === '5g' ? '5 GHz' : '2.4 GHz') : ' · off'}</span>`).join(' '); },
	actions(p) {
		const a = [];
		if (p.state === 'a') {
			if (this.isOpen(p) && !p.devices.length) a.push([ 'full', 'Show QR', '' ], [ 'edit', 'Edit', '' ], [ 'cancel', 'Cancel QR', 'r' ]);
			else {
				a.push([ 'edit', 'Edit', '' ], [ 'extend', '+1h', '' ]);
				if (!this.isOpen(p)) {
					if (p.devices.some(x => !x.online)) a.push([ 'unlock', 'Unlock', 'o' ]);
					else if (p.devices.length < p.devs) a.push([ 'unlock', 'Add phone', 'o' ]);
				}
				a.push([ 'revoke', 'Revoke', 'r' ]);
			}
		}
		else if (p.why === 'time' || p.why === 'data') a.push([ 'edit', 'Raise limit', '' ], [ 'extend', '+1h', '' ]);
		return a.map(([ k, t, c ]) => `<button class="mini ${c}" data-a="${k}" data-id="${p.id}">${t}</button>`).join('');
	},
	hdrBtns() {
		return `<span class="hbtns"><button class="gear" data-a="settings" aria-label="Settings">⚙︎</button><button class="sw" role="switch" aria-checked="${this.st.on}" aria-label="Guest Wi-Fi" data-a="power"></button></span>`;
	},
	offNote() { return '<div class="empty" style="margin-top:12px">Guest Wi-Fi is off. Turn it on, then tap Next guest when someone arrives.</div>'; },
	groups() {
		const st = this.st;
		return {
			c: st.passes.find(p => p.id === st.cur),
			act: st.passes.filter(p => p.state === 'a' && !(this.isOpen(p) && !p.devices.length)),
			end: st.passes.filter(p => p.state === 'e'),
		};
	},

	/* ---------- style 1: wallet ---------- */
	wallet() {
		const st = this.st, { c, act, end } = this.groups(), L = this.last;
		let h = `<div class="hdr"><h2 class="lt">Guest Pass</h2>${this.hdrBtns()}</div>
			<div class="capline">${esc(st.ssid)} · WPA2 · all guests together max ${st.cap} Mbps</div>`;
		if (!st.on) return h + this.offNote();
		if (c) {
			h += `<div class="pass"><div class="p-h"><span class="p-logo">📶</span><span class="p-org">${esc(st.ssid)}</span><span style="text-align:right"><small>Pass</small><b>#${c.id}</b></span></div>
				<div class="p-prim"><small>${c.label ? esc(c.label) + ' · ' : ''}Password for this guest only</small><b class="mono">${this.pw(c)}</b></div>
				<div class="p-sec"><div><small>Time</small><b>${dur(c.time)}</b></div><div><small>Data</small><b>${fmtMB(c.data)}</b></div><div><small>Speed</small><b>${c.speed} Mbps</b></div><div><small>Devices</small><b>${c.devices.length}/${c.devs}</b></div></div>
				<div class="p-perf"></div>
				<div class="p-qr"><div class="qr" data-a="full" data-id="${c.id}">${this.qr(c)}</div><span>${c.devices.length ? this.who(c) + ' joined · ' + (c.devs - c.devices.length) + ' more can scan' : (c.start ? 'Unlocked: scan again to reconnect' : 'Waiting for guest') + ' · closes in ' + dur(this.openLeft())}</span></div></div>
				<div class="btns"><button class="btn" data-a="full" data-id="${c.id}">Show to Guest</button><button class="btn sec" data-a="edit" data-id="${c.id}">Edit</button>${c.devices.length ? '<button class="btn sec" data-a="new">Next guest</button>' : `<button class="btn red" data-a="cancel" data-id="${c.id}">Cancel QR</button>`}</div>`;
		}
		else {
			h += `<div class="pass void"><div class="p-h"><span class="p-logo">📶</span><span class="p-org">${esc(st.ssid)}</span></div>
				<div class="p-prim"><small>No QR open</small><b style="font-size:21px">Nobody new can join</b></div>
				<div style="font-size:13px;opacity:.88">Tap Next guest when someone arrives. Last used: ${dur(L.time)} · ${fmtMB(L.data)} · ${L.speed} Mbps</div></div>
				<button class="btn" style="margin-top:12px" data-a="new">＋ Next guest</button>`;
		}
		h += `<div class="sect"><span>Guests · ${act.reduce((n, p) => n + this.online(p).length, 0)} online</span></div>`;
		h += act.length ? `<div class="tix">${act.map(p => this.ticket(p)).join('')}</div>` : '<div class="empty">No guests yet</div>';
		if (end.length) h += `<div class="sect"><span>Ended</span><a data-a="clear">Clear</a></div><div class="tix">${end.map(p => this.ticket(p)).join('')}</div>`;
		return h;
	},
	ticket(p) {
		const s = this.status(p), v = this.pct(p), cls = x => x >= 100 ? 'x' : x >= 85 ? 'w' : '';
		return `<div class="tick ${p.state === 'e' ? 'ended' : ''}" style="--c:${color(p)}"><div class="stub"></div><div class="body">
			<div class="t1"><b>${this.title(p)}</b><span class="st ${s[0]}">${esc(s[1])}</span></div>
			<div class="m">${p.speed} Mbps${p.devs > 1 ? ' shared' : ''} · ${p.devices.length}/${p.devs} device · ${this.devTags(p) || 'no phone yet'}</div>
			<div class="meters"><div><span><em style="font-style:normal">Time</em><em style="font-style:normal">${p.start ? dur(this.left(p)) + ' left' : dur(p.time)}</em></span><div class="bar"><i class="${cls(v.t)}" style="width:${v.t}%"></i></div></div>
			<div><span><em style="font-style:normal">Data</em><em style="font-style:normal">${fmtB(p.used)} / ${fmtMB(p.data)}</em></span><div class="bar"><i class="${cls(v.d)}" style="width:${v.d}%"></i></div></div></div>
			<div class="acts">${this.actions(p)}</div></div></div>`;
	},

	/* ---------- style 2: dashboard ---------- */
	dash() {
		const st = this.st, { c, act, end } = this.groups(), L = this.last;
		let h = `<div class="hdr"><h2 class="lt">Guests</h2>${this.hdrBtns()}</div>
			<div class="capline">${esc(st.ssid)} · WPA2 · ${st.on ? 'on' : 'off'}</div>`;
		if (!st.on) return h + this.offNote();
		const on = act.reduce((n, p) => n + this.online(p).length, 0);
		const sp = Math.min(st.cap, act.filter(p => this.online(p).length).reduce((n, p) => n + p.speed, 0));
		const used = fmtB(st.passes.reduce((n, p) => n + p.used, 0)).split(' ');
		h += `<div class="stats"><div class="stat"><small>Online</small><b>${on}</b> <em>phones</em></div><div class="stat"><small>Speed booked</small><b>${sp}</b> <em>/ ${st.cap} Mbps</em></div><div class="stat"><small>Data used</small><b>${used[0]}</b> <em>${used[1]}</em></div></div><div class="tiles">`;
		if (c) h += `<div class="tile open"><div class="tt"><b>${this.title(c)}</b><small>${c.devices.length ? c.devices.length + '/' + c.devs : 'waiting · ' + dur(this.openLeft())}</small></div>
			<div style="display:flex;gap:10px;align-items:center"><div class="qr" data-a="full" data-id="${c.id}">${this.qr(c, 2)}</div><div><b class="mono" style="font-size:16px">${this.pw(c)}</b><small style="display:block">${dur(c.time)} · ${fmtMB(c.data)} · ${c.speed} Mbps</small></div></div>
			<div class="tbtns"><button class="mini" data-a="full" data-id="${c.id}">Show</button><button class="mini" data-a="edit" data-id="${c.id}">Edit</button>${c.devices.length ? '<button class="mini" data-a="new">Next</button>' : `<button class="mini" data-a="cancel" data-id="${c.id}">Cancel</button>`}</div></div>`;
		if (!c || c.devices.length) h += `<button class="tile new" data-a="new"><span class="plus">＋</span>Next guest<small>${dur(L.time)} · ${fmtMB(L.data)} · ${L.speed} Mbps</small></button>`;
		h += act.filter(p => p !== c).concat(end).map(p => this.tile(p)).join('') + '</div>';
		if (end.length) h += '<div class="sect"><span></span><a data-a="clear">Clear ended</a></div>';
		return h;
	},
	tile(p) {
		const s = this.status(p), v = this.pct(p), col = s[1] === 'Offline' ? 'var(--orange)' : color(p);
		return `<button class="tile ${p.state === 'e' ? 'ended' : ''}" data-a="det" data-id="${p.id}">
			<div class="tt"><b>${this.title(p)}</b><span class="dots">${p.devices.map(x => `<i style="background:${x.online ? color(p) : '#8e8e93'}">${esc((x.name || '?')[0])}</i>`).join('')}</span></div>
			<div style="display:flex;align-items:center;gap:10px">${this.ring(v.t, 52, col)}<div><div class="big">${p.state === 'e' ? '—' : dur(this.left(p))}</div><small>left</small></div></div>
			<div class="bar"><i style="width:${v.d}%"></i></div>
			<small>${fmtB(p.used)} / ${fmtMB(p.data)} · ${p.speed} Mbps</small>
			<small class="st ${s[0]}">${esc(s[1])}</small></button>`;
	},

	/* ---------- overlays ---------- */
	layer() {
		const o = this.ov, st = this.st;
		if (!o) return '';
		const p = o.id ? st.passes.find(x => x.id === o.id) : null;
		if ((o.kind === 'det' || o.kind === 'full') && !p) { this.ov = null; return ''; }
		if (o.kind === 'full') return `<div class="full" role="dialog" aria-label="QR for guest"><b style="font-size:20px">${esc(st.ssid)}</b><div class="qr">${this.qr(p, 6)}</div>
			<p>Scan with the camera, or type the password</p><div class="mono">${this.pw(p)}</div>
			<p>${dur(p.time)} · ${p.data ? fmtMB(p.data) : 'no data limit'} · ${p.speed} Mbps · ${p.devs} device${p.devs > 1 ? 's' : ''}</p>
			<button class="btn" data-a="close">Done</button></div>`;
		if (o.kind === 'off') return `<div class="ov" data-a="close" data-self><div class="sheet" role="alertdialog" aria-label="Turn off guest Wi-Fi">
			<div class="sh-h"><button class="link l" data-a="close">Cancel</button><b>Turn off Guest Wi-Fi?</b><span></span></div>
			<div class="note">All passes end and every guest is disconnected.</div><button class="btn red" data-a="offyes">Turn Off</button></div></div>`;
		if (o.kind === 'settings') {
			const card = (v, name, sub, pic) => `<button class="style ${st.view === v ? 'sel' : ''}" aria-pressed="${st.view === v}" data-a="view" data-v="${v}"><span class="pic">${pic}</span><b>${name}</b><small>${sub}</small><span class="tickm">${st.view === v ? '✓' : ''}</span></button>`;
			return `<div class="ov" data-a="close" data-self><div class="sheet" role="dialog" aria-label="Settings">
				<div class="sh-h"><span></span><b>Settings</b><button class="link r" data-a="close">Done</button></div>
				<div class="sect" style="margin-top:4px"><span>Page style</span></div>
				<div class="styles">${card('wallet', 'Wallet', 'Big pass + QR on top, guests as tickets below', '<i class="pw-card"></i><i class="pw-qr"></i><i class="pw-line"></i><i class="pw-line s"></i>')}${card('dashboard', 'Dashboard', 'Totals on top, one tile per guest', '<i class="pd-stats"></i><i class="pd-t a"></i><i class="pd-t"></i><i class="pd-t"></i><i class="pd-t"></i>')}</div>
				<div class="note">Saved on the router, so your phone and laptop show the same style. Only the look changes: guests, passes and limits stay as they are.</div>
				<div class="sect"><span>Guest Wi-Fi</span></div>
				<div class="kv"><div><span>Network</span><b>${esc(st.ssid)}</b></div><div><span>Security</span><b>WPA2</b></div><div><span>All guests together</span><b>max ${st.cap} Mbps</b></div><div><span>Unused QR closes after</span><b>${st.open_min} min</b></div></div>
				</div></div>`;
		}
		if (o.kind === 'det') {
			const s = this.status(p), v = this.pct(p);
			return `<div class="ov" data-a="close" data-self><div class="sheet" role="dialog" aria-label="Pass details">
				<div class="sh-h"><span></span><b>${this.title(p)}</b><button class="link r" data-a="close">Done</button></div>
				<div class="det-hero">${this.ring(v.t, 64, color(p))}<div><b>${p.state === 'e' ? esc(WHY[p.why] || 'Ended') : p.start ? dur(this.left(p)) + ' left' : 'Not started'}</b><span class="st ${s[0]}">${esc(s[1])}</span></div></div>
				<div class="kv"><div><span>Data</span><b>${fmtB(p.used)} / ${fmtMB(p.data)}</b></div><div><span>Speed</span><b>${p.speed} Mbps${p.devs > 1 ? ' shared' : ''}</b></div><div><span>Devices</span><b>${p.devices.length} / ${p.devs}</b></div><div><span>Password</span><b class="mono">${this.pw(p)}</b></div></div>
				${p.devices.length ? `<div class="kv">${p.devices.map(x => `<div><span>${esc(x.name || 'Unknown')}<br><small style="font-size:11.5px">${esc(x.mac)}</small></span><b><span class="tag ${x.online ? 'on' : ''}">${x.online ? (x.band === '5g' ? '5 GHz' : '2.4 GHz') : 'offline'}</span></b></div>`).join('')}</div>` : ''}
				<div class="dgrid">${this.actions(p)}</div></div></div>`;
		}
		// form: new guest or edit
		const f = o.f, used = p && p.devices.length, c = st.passes.find(x => x.id === st.cur);
		const ch = k => {
			const opts = OPT[k].slice();
			if (!opts.some(x => x[0] === f[k])) opts.push([ f[k], k === 'time' ? dur(f[k]) : k === 'data' ? fmtMB(f[k]) : k === 'speed' ? f[k] + ' Mbps' : String(f[k]) ]);
			return opts.map(([ v, l ]) => `<button class="opt" aria-pressed="${f[k] === v}" data-a="opt" data-k="${k}" data-v="${v}" ${k === 'devs' && p && v < p.devices.length ? 'disabled' : ''}>${l}</button>`).join('');
		};
		return `<div class="ov" data-a="close" data-self data-form><div class="sheet" role="dialog" aria-label="${p ? 'Edit pass' : 'Next guest'}">
			<div class="sh-h"><button class="link l" data-a="close">Cancel</button><b>${p ? 'Edit pass #' + p.id : 'Next guest'}</b><button class="link r" data-a="save">${p ? 'Save' : 'Create'}</button></div>
			<div class="note">${p ? (used ? 'Changes apply live. ' + this.who(p) + ' stays connected.' : 'Nobody has scanned yet. The QR stays the same, only the limits change.')
				: c && !c.devices.length ? `QR #${c.id} is open and unused. Creating a new one replaces it.` : 'This guest gets their own password, time, data and speed. Other guests are not affected.'}</div>
			<div class="field"><label>Time ${p && p.start ? '(counts from first connect, ' + dur((st.now - p.start) / 60) + ' used)' : '(starts at first connect)'}</label><div class="opts">${ch('time')}</div></div>
			<div class="field"><label>Data ${p && p.used ? '(' + fmtB(p.used) + ' used)' : ''}</label><div class="opts">${ch('data')}</div></div>
			<div class="field"><label>Speed (download + upload)</label><div class="opts">${ch('speed')}</div></div>
			<div class="field"><label>Devices on this pass (they share time, data, speed)</label><div class="opts">${ch('devs')}</div></div>
			<div class="field"><label>Name (optional)</label><input data-k="label" maxlength="24" placeholder="e.g. Rahul family" value="${esc(f.label)}"></div>
			${p && !used ? `<button class="btn red" data-a="cancel" data-id="${p.id}">Delete this QR</button>` : ''}
			</div></div>`;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
