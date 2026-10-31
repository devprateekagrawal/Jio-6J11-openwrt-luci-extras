'use strict';
'require view';
'require rpc';
'require poll';

// Guest Wi-Fi: on/off with timer, data limit and speed limit (backend /usr/bin/guestwifi.sh).
// Shown as a Wallet-style guest pass, following Apple's Human Interface Guidelines.
// All markup is built from strings, so every value from the router goes through esc() (device names come from guests).

const callStatus = rpc.declare({ object: 'guestwifi', method: 'status' });
const callOn = rpc.declare({ object: 'guestwifi', method: 'on', params: [ 'minutes', 'data_mb', 'speed_mbps' ] });
const callOff = rpc.declare({ object: 'guestwifi', method: 'off' });
const callNewpass = rpc.declare({ object: 'guestwifi', method: 'newpass' });

const MB = 1048576;
const KEYS = [ 'minutes', 'data', 'speed' ];
const OPTS = {
	minutes: [ [ 60, '1 Hour' ], [ 180, '3 Hours' ], [ -1, 'Until Midnight' ], [ 0, 'No Timer' ] ],
	data: [ [ 500, '500 MB' ], [ 1024, '1 GB' ], [ 2048, '2 GB' ], [ 0, 'No Limit' ] ],
	speed: [ [ 10, '10 Mbps' ], [ 20, '20 Mbps' ], [ 0, 'No Limit' ] ]
};
const SEGL = { minutes: [ '1 Hour', '3 Hours', 'Midnight', 'Always' ], data: [ '500 MB', '1 GB', '2 GB', 'No Limit' ], speed: [ '10 Mbps', '20 Mbps', 'No Limit' ] };
const KEYLBL = { minutes: 'Turn Off After', data: 'Data Limit', speed: 'Speed Limit' };
const SHEETLBL = { minutes: 'Valid For', data: 'Data', speed: 'Speed' };
const AVC = [ '#ff9500', '#5856d6', '#30b0c7' ];

const PRIVACY = 'Guests get internet only. They can’t see your devices or open this page.';
const AUTO_OFF = 'Guest Wi-Fi turns off by itself when time or data runs out, and stays off after the router restarts.';

const ICONS = {
	wifi: 'M2.2 9a13.8 13.8 0 0 1 19.6 0 M5.4 12.2a9.3 9.3 0 0 1 13.2 0 M8.6 15.4a4.8 4.8 0 0 1 6.8 0 M12 18.8h.01',
	qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2.5v2.5H14z M18 18h2v2h-2z M17.5 14H20 M14 19.5h2',
	more: 'M6 12h.01 M12 12h.01 M18 12h.01',
	check: 'M5 12.5l4.5 4.5L19 7.5',
	updown: 'M8 9.5 12 5.5l4 4 M8 14.5l4 4 4-4',
	alert: 'M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0z M12 9.5v4.5 M12 17.2h.01',
	phone: 'M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z M10.5 18.5h3',
	laptop: 'M5 6h14v9.5H5z M3 18.5h18',
	question: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6 M12 17h.01'
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const I = (n, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const optLabel = (k, v) => (OPTS[k].find(o => o[0] === v) || [ v, `${v}` ])[1];
const at = sec => new Date(sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function fmtDur(s) {
	if (s < 60) return 'Less than 1 min';
	const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
	return h ? (m ? `${h} hr ${m} min` : `${h} hr`) : `${m} min`;
}

const fmtB = b => b >= 1073741824 ? `${(b / 1073741824).toFixed(2).replace(/\.?0+$/, '')} GB` : `${Math.round(b / MB)} MB`;

const cName = c => c.name || 'Unknown Device';
const cBand = c => c.band === '5g' ? '5 GHz' : '2.4 GHz';
const cIcon = c => !c.name ? 'question' : /iphone|galaxy|pixel|redmi|oneplus|realme|vivo|oppo|phone|android/i.test(c.name) ? 'phone' : 'laptop';

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

// Inter comes in through a <link>, not an @import in CSS: with an @import none of the
// page's styles applied until Google answered, so the page flashed unstyled (huge icons)
if (!document.getElementById('inter-font'))
	document.head.appendChild(E('link', { id: 'inter-font', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap' }));

const CSS = `
.gp{
 --bg:#f2f2f7;--card:#fff;--label:#000;--label2:#6e6e73;--label3:#aeaeb2;--sep:rgba(60,60,67,.22);
 --fill:rgba(120,120,128,.16);--fill2:rgba(120,120,128,.1);--press:rgba(0,0,0,.06);
 --blue:#007aff;--blueText:#0066cc;--blueFill:#0071e3;--green:#34c759;--red:#ff3b30;--redText:#d70015;--orange:#ff9500;
 --thumb:#fff;--alertBg:rgba(242,242,247,.86);--menuBg:rgba(250,250,252,.92);
 --glass:rgba(255,255,255,.62);--glassEdge:rgba(255,255,255,.75);--glassShade:0 10px 34px rgba(0,0,0,.14);
 background:var(--bg);color:var(--label);border-radius:18px;padding:12px 20px 40px;margin:8px auto 24px;max-width:680px;
 font:15px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:-.005em;
 -webkit-font-smoothing:antialiased;text-align:left
}
:root[data-darkmode="true"] .gp{
 --bg:#000;--card:#1c1c1e;--label:#fff;--label2:#98989f;--label3:#636366;--sep:rgba(84,84,88,.6);
 --fill:rgba(120,120,128,.36);--fill2:rgba(120,120,128,.22);--press:rgba(255,255,255,.08);
 --blue:#0a84ff;--blueText:#409cff;--green:#30d158;--red:#ff453a;--redText:#ff6961;--orange:#ff9f0a;
 --thumb:#636366;--alertBg:rgba(40,40,42,.86);--menuBg:rgba(44,44,46,.92);
 --glass:rgba(38,38,42,.6);--glassEdge:rgba(255,255,255,.16);--glassShade:0 10px 34px rgba(0,0,0,.5)
}
.gp *{box-sizing:border-box}
.gp button{all:unset;box-sizing:border-box;cursor:pointer}
.gp button:disabled{cursor:default}
.gp :focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:6px}
.gp .i{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none;display:block}
.gp .wrap{max-width:430px;margin:0 auto}
.gp .top{display:flex;align-items:center;justify-content:space-between}
.gp .lt{font:inherit;font-size:32px;font-weight:700;letter-spacing:-.025em;margin:14px 4px 18px;line-height:1.1;color:var(--label);border:0;padding:0;background:none}
.gp .more{width:32px;height:32px;border-radius:50%;background:var(--fill2);color:var(--label);display:grid;place-items:center}
.gp .more .i{stroke-width:3.2}
.gp .hdr{margin:26px 16px 7px;font-size:13px;color:var(--label2);text-transform:uppercase;letter-spacing:.01em}
.gp .ftr{font-size:13px;color:var(--label2);margin:7px 16px 0;line-height:1.38}
.gp .ftr.c{text-align:center}
.gp .card{background:var(--card);border-radius:12px;overflow:hidden}
.gp .row{display:flex;align-items:center;gap:12px;min-height:44px;padding:7px 16px;position:relative;width:100%;text-align:left;color:var(--label)}
.gp .row+.row::before{content:"";position:absolute;top:0;right:0;left:16px;border-top:.5px solid var(--sep)}
.gp button.row:not(:disabled):active{background:var(--press)}
.gp .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp .stk{display:flex;flex-direction:column;gap:1px}
.gp .stk small{font-size:13px;color:var(--label2);overflow:hidden;text-overflow:ellipsis}
.gp .val{color:var(--label2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:62%;display:flex;align-items:center;gap:6px}
.gp .chev{color:var(--label3);width:15px;height:15px;stroke-width:2.4}
.gp .acc{color:var(--blueText)}
.gp .dest{color:var(--redText)}
.gp button:disabled .acc,.gp button:disabled .dest{color:var(--label3)}
.gp .link{color:var(--blueText);font-size:17px;padding:4px 2px}
.gp .link.b{font-weight:600}
.gp .btn{border-radius:12px;padding:0 18px;height:50px;font-weight:600;font-size:17px;background:var(--blueFill);color:#fff;display:flex;align-items:center;justify-content:center;gap:8px;width:100%}
.gp .btn:disabled{opacity:.45}
.gp .btn:not(:disabled):active{opacity:.75}
.gp .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.02em}
.gp .meter{height:5px;border-radius:3px;background:var(--fill);overflow:hidden;margin-top:6px}
.gp .meter i{display:block;height:100%;border-radius:3px;background:var(--blue)}
.gp .meter i.hot{background:var(--orange)}
.gp .gic{width:30px;height:30px;border-radius:50%;background:var(--fill2);display:grid;place-items:center;color:var(--label2);flex:none}
.gp .gic .i{width:17px;height:17px}
.gp .seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--fill2);border-radius:9px;padding:2px;gap:2px;width:100%}
.gp .seg button{border-radius:7px;height:30px;font-size:14px;font-weight:500;text-align:center;color:var(--label);white-space:nowrap}
.gp .seg button[aria-checked=true]{background:var(--thumb);box-shadow:0 3px 8px rgba(0,0,0,.12),0 1px 1px rgba(0,0,0,.05);font-weight:600}
.gp .qr{background:#fff;border-radius:12px;padding:9px;flex:none;width:156px;height:156px}
.gp .qr svg{width:100%;height:100%;display:block}
.gp .qr.none{display:grid;place-items:center;color:#6e6e73;font-size:12px;text-align:center}

/* the pass */
.gp .pass{position:relative;border-radius:18px;color:#fff;background:linear-gradient(160deg,#14a08a 0%,#0e737a 50%,#173f6b 100%);padding:16px 18px 20px;box-shadow:0 16px 36px rgba(0,0,0,.24)}
.gp .pass.void{background:linear-gradient(160deg,#9a9aa0,#5d5d63)}
.gp [data-anim]{animation:gp-flip .4s cubic-bezier(.2,.8,.2,1)}
@keyframes gp-flip{from{transform:perspective(1000px) rotateY(-80deg);opacity:.2}}
.gp .p-h{display:flex;align-items:center;gap:9px}
.gp .p-logo{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.2);display:grid;place-items:center;flex:none;color:#fff}
.gp .p-logo .i{width:18px;height:18px;stroke-width:2.2}
.gp .p-org{font-weight:600;font-size:15px;flex:1}
.gp .pass small{display:block;font-size:10.5px;font-weight:600;letter-spacing:.07em;opacity:.78;text-transform:uppercase}
.gp .pf{text-align:right}
.gp .pf b{font-size:17px;font-weight:600}
.gp .p-prim{margin:20px 0 16px}
.gp .p-prim b{font-size:27px;font-weight:600;letter-spacing:-.02em;display:block;line-height:1.15;overflow-wrap:anywhere}
.gp .p-sec{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:10px}
.gp .p-sec b{font-size:15px;font-weight:600;white-space:nowrap}
.gp .p-perf{position:relative;border-top:1.5px dashed rgba(255,255,255,.4);margin:20px -18px 0}
.gp .p-perf::before,.gp .p-perf::after{content:"";position:absolute;top:-12px;width:22px;height:22px;border-radius:50%;background:var(--bg)}
.gp .p-perf::before{left:-11px}
.gp .p-perf::after{right:-11px}
.gp .p-qr{display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:20px}
.gp .p-qr span{font-size:13px;opacity:.9;text-align:center}
.gp .stamp{position:absolute;top:70px;right:16px;transform:rotate(-7deg);border:2px solid rgba(255,255,255,.9);border-radius:6px;padding:3px 9px;font-size:12px;font-weight:700;letter-spacing:.1em}
.gp .strip{display:flex;align-items:center;gap:10px;margin:18px 4px 0;font-size:14px;color:var(--label2)}
.gp .avs{display:flex;flex:none}
.gp .av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700;border:2px solid var(--bg);margin-left:-8px}
.gp .av:first-child{margin-left:0}
.gp .acts{margin-top:20px}

/* back of the pass */
.gp .pb-top{display:flex;align-items:center;gap:12px;margin:14px 4px 4px}
.gp .pb-top .p-logo{background:linear-gradient(160deg,#14a08a,#173f6b);width:42px;height:42px;border-radius:11px}
.gp .pb-top div{flex:1;min-width:0}
.gp .pb-top b{font-size:17px;display:block}
.gp .pb-top small{font-size:13px;color:var(--label2)}

/* overlays */
.gp .ov{position:fixed;inset:0;background:rgba(0,0,0,.32);display:grid;place-items:center;z-index:1000;animation:gp-fade .18s ease-out}
.gp .ov.clear{background:none;animation:none;display:block}
@keyframes gp-fade{from{opacity:0}}
@keyframes gp-pop{from{transform:scale(1.08);opacity:0}}
@keyframes gp-rise{from{transform:translateY(40px);opacity:.4}}
@keyframes gp-menu{from{transform:scale(.6);opacity:0}}
.gp .alert{width:270px;border-radius:14px;background:var(--alertBg);-webkit-backdrop-filter:blur(30px) saturate(1.8);backdrop-filter:blur(30px) saturate(1.8);text-align:center;overflow:hidden;animation:gp-pop .2s ease-out;color:var(--label)}
.gp .alert h4{margin:19px 16px 3px;font-size:17px;font-weight:600;color:var(--label);border:0;padding:0;background:none}
.gp .alert p{margin:0 16px 19px;font-size:13px;line-height:1.35}
.gp .alert .two{display:grid;grid-template-columns:1fr 1fr;border-top:.5px solid var(--sep)}
.gp .alert .two button{height:44px;font-size:17px;color:var(--blueText);text-align:center}
.gp .alert .two button+button{border-left:.5px solid var(--sep)}
.gp .alert .two .def{font-weight:600}
.gp .alert .two .des{color:var(--redText)}
.gp .menu{position:fixed;width:236px;border-radius:14px;background:var(--menuBg);-webkit-backdrop-filter:blur(30px) saturate(1.8);backdrop-filter:blur(30px) saturate(1.8);box-shadow:0 12px 40px rgba(0,0,0,.25),0 0 0 .5px var(--sep);padding:5px 0;animation:gp-menu .18s cubic-bezier(.2,.9,.3,1.2);color:var(--label)}
.gp .menu h6{margin:4px 14px 4px 40px;font-size:12px;font-weight:500;color:var(--label2);text-transform:none;letter-spacing:0;border:0;padding:0}
.gp .menu button{display:flex;align-items:center;gap:8px;width:100%;height:42px;padding:0 14px 0 12px;font-size:16px}
.gp .menu button:hover{background:var(--press)}
.gp .menu .ck{width:20px;flex:none;display:grid;place-items:center}
.gp .menu .ck .i{width:16px;height:16px;stroke-width:2.6}
.gp .sheet{position:fixed;left:0;right:0;bottom:0;max-height:92vh;background:var(--bg);color:var(--label);border-radius:14px 14px 0 0;display:flex;flex-direction:column;animation:gp-rise .25s ease-out;box-shadow:0 -10px 40px rgba(0,0,0,.2)}
.gp .sheet .nav{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:8px 16px 4px;min-height:52px}
.gp .sheet .nav h3{margin:0;font-size:17px;font-weight:600;text-align:center;color:var(--label);border:0;padding:0;background:none}
.gp .sheet .nav .r{justify-self:end}
.gp .sheet .nav .l{justify-self:start}
.gp .sheet .body{overflow:auto;padding:4px 20px 34px}
.gp .sheet .hdr:first-child{margin-top:10px}
@media (min-width:700px){.gp .sheet{left:50%;top:50%;bottom:auto;transform:translate(-50%,-50%);width:500px;max-height:86vh;border-radius:16px;animation:gp-pop .22s ease-out}}
.gp .full{width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 24px);overflow:auto;background:var(--card);color:var(--label);border-radius:28px;padding:26px 24px 20px;text-align:center;animation:gp-pop .22s ease-out;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.gp .full .fic{width:56px;height:56px;border-radius:50%;background:var(--blue);color:#fff;display:grid;place-items:center;margin:0 auto 12px}
.gp .full .fic .i{width:30px;height:30px;stroke-width:2}
.gp .full h3{margin:0;font-size:21px;letter-spacing:-.015em;color:var(--label);border:0;padding:0;background:none;overflow-wrap:anywhere}
.gp .full p{margin:4px 0 16px;color:var(--label2);font-size:14px}
.gp .full .qr{width:220px;height:220px;margin:0 auto;padding:12px;border-radius:18px;box-shadow:0 0 0 1px var(--sep)}
.gp .full .pw{margin:16px 0 18px}
.gp .full .pw small{display:block;font-size:12px;color:var(--label2);text-transform:uppercase;letter-spacing:.06em}
.gp .full .pw b{font-size:24px;font-weight:600;letter-spacing:.08em}
.gp .full .note{background:var(--fill2);border-radius:12px;padding:10px 12px;font-size:13px;color:var(--label2);margin-bottom:16px}
.gp .hud{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:1001;padding:10px 18px;border-radius:999px;background:var(--glass);border:1px solid var(--glassEdge);-webkit-backdrop-filter:blur(24px) saturate(1.8);backdrop-filter:blur(24px) saturate(1.8);box-shadow:var(--glassShade);font-size:14px;font-weight:600;display:flex;gap:8px;align-items:center;max-width:calc(100vw - 32px);animation:gp-fade .2s;color:var(--label)}
.gp .hud .i{color:var(--green);width:18px;height:18px;stroke-width:2.4}
.gp .hud.err .i{color:var(--red)}
@media (max-width:480px){.gp{padding:8px 12px 32px;border-radius:0;margin:0 -8px}.gp .val{max-width:55%}.gp .p-prim b{font-size:24px}}
@media (pointer:coarse){.gp .more{width:44px;height:44px}}
@media (prefers-reduced-motion:reduce){.gp *{animation:none!important}}
`;

return view.extend({
	load() {
		return Promise.all([ callStatus(), loadQRLib() ]);
	},

	render([ st ]) {
		this.c = { minutes: 180, data: 1024, speed: 20 };   // what the next "on" will use
		this.back = false;     // showing the back of the pass
		this.busy = null;      // 'on', 'off' or 'newpass' while the router works
		this.ov = null;        // open overlay: { kind: 'menu' | 'create' | 'full' | 'alert', ... }

		const root = this.root = document.createElement('div');
		root.className = 'gp';
		root.innerHTML = `<style>${CSS}</style><div class="wrap" data-r="main"></div><div data-r="layer"></div><div data-r="hud"></div>`;
		const r = this.r = {};
		root.querySelectorAll('[data-r]').forEach(el => r[el.dataset.r] = el);

		root.addEventListener('click', ev => {
			const t = ev.target.closest('[data-a]');
			if (!t || t.disabled || !root.contains(t)) return;
			if (t.hasAttribute('data-self') && ev.target !== t) return;   // clicks inside a dialog don't close it
			ev.preventDefault();
			this.act(t.dataset.a, t.dataset.v, t);
		});
		root.addEventListener('keydown', ev => {
			if (ev.key === 'Escape' && this.ov) this.act(this.ov.kind === 'alert' ? 'alert-no' : 'close');
			if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && ev.target.getAttribute('role') === 'radio') {
				const [ k ] = ev.target.dataset.v.split(':'), o = OPTS[k];
				const j = o.findIndex(x => x[0] === this.c[k]) + (ev.key === 'ArrowRight' ? 1 : -1);
				if (o[j]) { this.act('opt', `${k}:${o[j][0]}`); r.layer.querySelector(`[data-v="${k}:${o[j][0]}"]`)?.focus(); }
			}
		});
		window.addEventListener('scroll', () => this.ov && this.ov.kind === 'menu' && this.act('close'), { passive: true });

		this.update(st);
		poll.add(() => callStatus().then(s => this.update(s)), 5);
		return root;
	},

	// While guest is on, the limits show what the router is actually running;
	// they follow the router again whenever it is switched on with new settings.
	syncChoice(st) {
		if (!st.on) { this.syncedSince = null; return; }
		if (st.since === this.syncedSince) return;
		this.syncedSince = st.since;
		const mins = Math.round((st.expires - st.since) / 60);
		const midnight = st.expires && new Date(st.expires * 1000).getHours() === 0 && !OPTS.minutes.some(t => t[0] === mins);
		this.running = { minutes: !st.expires ? 0 : midnight ? -1 : mins, data: st.data_mb, speed: st.speed_mbps };
		this.c = { ...this.running };
	},

	changed() {
		return this.st.on && this.running && KEYS.some(k => this.c[k] !== this.running[k]);
	},

	// replaces a section only when its markup changed, so polling doesn't restart animations;
	// keyboard focus goes back to the same control afterwards
	put(el, html) {
		if (el._html === html) return;
		const ae = document.activeElement;
		const sel = ae && el.contains(ae) && ae.dataset.a ? `[data-a="${ae.dataset.a}"]${ae.dataset.v != null ? `[data-v="${ae.dataset.v}"]` : ''}` : null;
		el._html = html;
		el.innerHTML = html;
		if (sel) el.querySelector(sel)?.focus({ preventScroll: true });
	},

	update(st) {
		this.st = st;
		this.syncChoice(st);
		this.draw();
	},

	draw() {
		const anim = this.flip ? 'data-anim' : '';
		this.flip = false;
		this.put(this.r.main, `<div class="top"><h2 class="lt">Guest Pass</h2>${this.back ? '' : `<button class="more" data-a="back" aria-label="Pass details">${I('more')}</button>`}</div>`
			+ (this.back ? this.backSide(anim) : this.front(anim)));
		this.drawLayer();
	},

	qr() {
		const st = this.st, text = wifiQR(st.ssid, st.key);
		if (!window.qrcode) return '<div class="qr none">QR code couldn’t load. Use the name and password.</div>';
		if (this.qrText !== text) {
			const q = window.qrcode(0, 'M');
			q.addData(text);
			q.make();
			this.qrText = text;
			this.qrSvg = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
		}
		return `<div class="qr" role="img" aria-label="QR code to join ${esc(st.ssid)}">${this.qrSvg}</div>`;
	},

	dataLeft() {
		const st = this.st;
		return Math.max(0, st.data_mb * MB - st.used);
	},

	untilText() {
		const st = this.st;
		if (st.expires) return `Turns off at ${at(st.expires)}${st.data_mb ? ` or after ${fmtB(st.data_mb * MB)}, whichever comes first` : ''}.`;
		return st.data_mb ? `Turns off after ${fmtB(st.data_mb * MB)}.` : 'Stays on until you turn it off.';
	},

	whoText() {
		const cl = this.st.clients, n = cl.length;
		if (!n) return 'No one has joined yet.';
		const first = esc(cName(cl[0]));
		return n === 1 ? `${first} is connected.` : `${first} and ${plural(n - 1, 'other')} are connected.`;
	},

	front(anim) {
		const st = this.st, on = st.on;
		const speed = on ? st.speed_mbps : this.c.speed;
		const exp = !on ? '—' : st.expires ? at(st.expires) : 'No Timer';
		const data = on ? (st.data_mb ? fmtB(this.dataLeft()) : 'Unlimited') : optLabel('data', this.c.data);
		const avatars = st.clients.slice(0, 3).map((c, k) => `<span class="av" style="background:${AVC[k]}">${esc((c.name || '?')[0].toUpperCase())}</span>`).join('');
		return `<div class="pass ${on ? '' : 'void'}" ${anim}>
			<div class="p-h"><span class="p-logo">${I('wifi')}</span><span class="p-org">Guest Wi-Fi</span><span class="pf"><small>Expires</small><b>${exp}</b></span></div>
			${on ? '' : '<span class="stamp">NOT ACTIVE</span>'}
			<div class="p-prim"><small>Wi-Fi Network</small><b>${esc(st.ssid)}</b></div>
			<div class="p-sec"><span><small>Password</small><b class="mono">${esc(st.key)}</b></span><span><small>${on && st.data_mb ? 'Data Left' : 'Data'}</small><b>${data}</b></span><span><small>Speed</small><b>${speed ? `${speed} Mbps` : 'Full'}</b></span></div>
			<div class="p-perf"></div>
			<div class="p-qr">${this.qr()}<span>${on ? 'Scan with the phone camera to join' : 'Turn the pass on so this code works'}</span></div>
		</div>
		${on ? `<div class="strip">${avatars ? `<span class="avs">${avatars}</span>` : ''}<span>${this.whoText()}</span></div>` : ''}
		<div class="acts">${on
			? `<button class="btn" data-a="full">${I('qr')}Show to Guest</button>`
			: `<button class="btn" data-a="create" ${this.busy ? 'disabled' : ''}>${this.busy === 'on' ? 'Turning On…' : 'Create Guest Pass'}</button>`}</div>
		<div class="ftr c">${on ? this.untilText() : PRIVACY}</div>`;
	},

	backSide(anim) {
		const st = this.st, on = st.on, busy = this.busy;
		const frac = on && st.data_mb ? Math.min(1, st.used / (st.data_mb * MB)) : 0;
		const meter = on && st.data_mb ? `<div class="meter"><i class="${frac > .8 ? 'hot' : ''}" style="width:${(frac * 100).toFixed(1)}%"></i></div>` : '';
		const guests = st.clients.length ? st.clients.map(c => `<div class="row"><span class="gic">${I(cIcon(c))}</span><span class="lbl stk">${esc(cName(c))}<small>${esc(c.ip || 'Getting an address…')} · ${cBand(c)}</small></span></div>`).join('')
			: '<div class="row"><span class="lbl" style="color:var(--label2)">No one has joined yet.</span></div>';
		const changed = this.changed();
		return `<div ${anim}>
			<div class="pb-top"><span class="p-logo">${I('wifi')}</span><div><b>Pass Details</b><small>${on ? `Active since ${at(st.since)}` : 'Not active'}</small></div><button class="link b" data-a="back">Done</button></div>
			${on ? `<div class="card" style="margin-top:14px">
				<div class="row"><span class="lbl">Time Left</span><span class="val">${st.expires ? fmtDur(st.remaining) : 'No timer'}</span></div>
				<div class="row"><span class="lbl stk">Data Used${meter}</span><span class="val">${st.data_mb ? `${fmtB(st.used)} of ${fmtB(st.data_mb * MB)}` : `${fmtB(st.used)} used`}</span></div>
				<div class="row"><span class="lbl">Speed</span><span class="val">${st.speed_mbps ? `${st.speed_mbps} Mbps, shared` : 'No limit'}</span></div></div>
			<div class="hdr">Connected Guests</div><div class="card">${guests}</div>` : ''}
			<div class="hdr">${on ? 'Limits' : 'Next Pass'}</div>
			<div class="card">${KEYS.map(k => `<button class="row" data-a="menu" data-v="${k}" aria-haspopup="menu"><span class="lbl">${KEYLBL[k]}</span><span class="val">${optLabel(k, this.c[k])}${I('updown', 'chev')}</span></button>`).join('')}
				${changed ? `<button class="row" data-a="apply" ${busy ? 'disabled' : ''}><span class="lbl acc">${busy === 'on' ? 'Applying…' : 'Apply New Limits'}</span></button>` : ''}</div>
			<div class="ftr">${changed ? 'Applying restarts the timer and the data count.' : `The speed limit is shared by all guests. ${AUTO_OFF}`}</div>
			<div class="card" style="margin-top:22px">
				<button class="row" data-a="newpass" ${busy ? 'disabled' : ''}><span class="lbl acc">${busy === 'newpass' ? 'Making a New Password…' : 'New Password'}</span></button>
				${on ? `<button class="row" data-a="off" ${busy ? 'disabled' : ''}><span class="lbl dest">${busy === 'off' ? 'Turning Off…' : 'Turn Off Pass'}</span></button>`
					: `<button class="row" data-a="on" ${busy ? 'disabled' : ''}><span class="lbl acc">${busy === 'on' ? 'Turning On…' : 'Turn On Pass'}</span></button>`}
			</div>
		</div>`;
	},

	drawLayer() {
		const o = this.ov, st = this.st;
		let html = '';
		if (o && o.kind === 'menu')
			html = `<div class="ov clear" data-a="close" data-self><div class="menu" role="menu" aria-label="${KEYLBL[o.k]}" style="left:${o.x}px;top:${o.y}px;transform-origin:${o.up ? 'bottom' : 'top'} right"><h6>${KEYLBL[o.k]}</h6>${
				OPTS[o.k].map(([ v, l ]) => `<button role="menuitemradio" aria-checked="${this.c[o.k] === v}" data-a="opt" data-v="${o.k}:${v}"><span class="ck">${this.c[o.k] === v ? I('check') : ''}</span>${l}</button>`).join('')}</div></div>`;
		else if (o && o.kind === 'create')
			html = `<div class="ov" data-a="close" data-self><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="gp-sh-t">
				<div class="nav"><button class="link l" data-a="close">Cancel</button><h3 id="gp-sh-t">New Guest Pass</h3><button class="link b r" data-a="on">Create</button></div>
				<div class="body">${KEYS.map(k => `<div class="hdr">${SHEETLBL[k]}</div><div class="seg" role="radiogroup" aria-label="${KEYLBL[k]}">${
					OPTS[k].map(([ v ], j) => `<button role="radio" aria-checked="${this.c[k] === v}" tabindex="${this.c[k] === v ? 0 : -1}" data-a="opt" data-v="${k}:${v}">${SEGL[k][j]}</button>`).join('')}</div>`).join('')}
				<div class="ftr" style="margin-top:14px">The speed limit is shared by all guests. ${AUTO_OFF}</div></div></div></div>`;
		else if (o && o.kind === 'full')
			html = `<div class="ov" data-a="close" data-self><div class="full" role="dialog" aria-modal="true" aria-labelledby="gp-fu-t">
				<div class="fic">${I('wifi')}</div><h3 id="gp-fu-t">Join “${esc(st.ssid)}”</h3><p>Point the phone camera at the code.</p>
				${st.on ? '' : '<div class="note">Guest Wi-Fi is off. Turn it on so this code works.</div>'}
				${this.qr()}
				<div class="pw"><small>Password</small><b class="mono">${esc(st.key)}</b></div>
				<button class="btn" data-a="close">Done</button></div></div>`;
		else if (o && o.kind === 'alert')
			html = `<div class="ov"><div class="alert" role="alertdialog" aria-modal="true" aria-labelledby="gp-al-t" aria-describedby="gp-al-m">
				<h4 id="gp-al-t">${esc(o.title)}</h4><p id="gp-al-m">${esc(o.msg)}</p>
				<div class="two"><button data-a="alert-no">Cancel</button><button class="${o.destructive ? 'des' : 'def'}" data-a="alert-yes">${esc(o.ok)}</button></div></div></div>`;
		this.put(this.r.layer, html);
	},

	open(ov, opener) {
		this.ov = ov;
		this.opener = opener || document.activeElement;
		this.drawLayer();
		const first = ov.kind === 'menu' ? this.r.layer.querySelector('[aria-checked="true"]')
			: ov.kind === 'alert' ? this.r.layer.querySelector('[data-a="alert-no"]')
			: ov.kind === 'create' ? this.r.layer.querySelector('[data-a="on"]')
			: this.r.layer.querySelector('.btn');
		first?.focus({ preventScroll: true });
	},

	close() {
		this.ov = null;
		this.drawLayer();
		const back = this.opener;
		this.opener = null;
		if (back && back.isConnected) back.focus({ preventScroll: true });
	},

	ask(title, msg, ok, destructive, yes) {
		const opener = this.ov ? this.opener : document.activeElement;
		this.open({ kind: 'alert', title, msg, ok, destructive, yes }, opener);
	},

	hud(text, err) {
		clearTimeout(this.hudTimer);
		const h = document.createElement('div');
		h.className = 'hud' + (err ? ' err' : '');
		h.setAttribute('role', 'status');
		h.innerHTML = I(err ? 'alert' : 'check');
		h.appendChild(document.createTextNode(text));
		this.r.hud.replaceChildren(h);
		this.hudTimer = setTimeout(() => h.remove(), err ? 4000 : 2200);
	},

	// runs a backend call; the router answers with the new status
	run(what, fn, ok) {
		this.busy = what;
		this.draw();
		return fn().then(st => {
			this.busy = null;
			this.update(st);
			this.hud(ok);
		}).catch(e => {
			this.busy = null;
			this.draw();
			this.hud(e.message, true);
		});
	},

	turnOn(ok) {
		const c = this.c;
		this.run('on', () => callOn(c.minutes, c.data, c.speed), ok);
	},

	act(a, v, el) {
		const st = this.st, n = st.clients.length;
		switch (a) {
		case 'back':
			this.back = !this.back;
			this.flip = true;
			this.draw();
			this.r.main.querySelector(this.back ? '[data-a="back"]' : '.more')?.focus({ preventScroll: true });
			break;
		case 'create':
			this.open({ kind: 'create' }, el);
			break;
		case 'full':
			this.open({ kind: 'full' }, el);
			break;
		case 'menu': {
			const rc = el.getBoundingClientRect(), h = OPTS[v].length * 42 + 36, w = 236;
			const up = rc.bottom + 6 + h > window.innerHeight - 8;
			this.open({ kind: 'menu', k: v, up,
				x: Math.round(Math.max(8, Math.min(rc.right - w, window.innerWidth - w - 8))),
				y: Math.round(up ? rc.top - 6 - h : rc.bottom + 6) }, el);
			break;
		}
		case 'opt': {
			const [ k, val ] = v.split(':');
			this.c[k] = +val;
			if (this.ov && this.ov.kind === 'menu') this.close();
			this.draw();
			break;
		}
		case 'close':
			this.close();
			break;
		case 'on':
			if (this.ov) this.close();
			this.turnOn('Guest pass is active');
			break;
		case 'apply':
			this.ask('Apply New Limits?', 'The timer and the data count start over.', 'Apply', false,
				() => this.turnOn('New limits applied'));
			break;
		case 'off':
			this.ask('Turn Off Guest Wi-Fi?', `${n ? `${plural(n, 'guest')} will be disconnected.` : 'Guests can’t join until you turn it on again.'}`, 'Turn Off', true,
				() => this.run('off', () => callOff(), 'Guest Wi-Fi is off'));
			break;
		case 'newpass':
			this.ask('Make a New Password?', 'Guests who are connected now will need the new password to join again.', 'New Password', false,
				() => this.run('newpass', () => callNewpass(), 'New password is ready'));
			break;
		case 'alert-yes': {
			const f = this.ov.yes;
			this.close();
			f();
			break;
		}
		case 'alert-no':
			this.close();
			break;
		}
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
