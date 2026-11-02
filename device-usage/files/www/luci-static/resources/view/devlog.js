'use strict';
'require view';
'require rpc';
'require poll';

// Copyright (c) 2026 Prateek Agrawal, MIT License
// https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras

// Device Usage: how much each Wi-Fi device downloads, minute by minute, and a
// per-device download speed limit (backend /usr/bin/devlog.sh: the access
// points' byte counters, and an HTB class per limited device on their egress).
// Layout = prototype 8 in prototypes/device-usage-prototypes.html next to the
// README: a list of need-vs-limit cards, and a detail page per device with the
// per-minute chart. Markup is built from strings, so every text from the router
// goes through esc().

const callGet = rpc.declare({ object: 'devlog', method: 'get', params: [ 'hours' ] });
const callLive = rpc.declare({ object: 'devlog', method: 'live' });
const callSet =rpc.declare({ object: 'devlog', method: 'setlimit', params: [ 'mac', 'on', 'mbps' ] });

const RANGES = [ [ 6, '6 Hours' ], [ 24, '24 Hours' ], [ 168, '7 Days' ], [ 720, '30 Days' ] ];
const USE = 1;     // Mbps, as in devlog.sh: a minute at least this fast is "in use"
const BUSY = 5;    // in-use minutes before a device gets a need scale
const DEF = 10;    // Mbps a new limit starts at

const ICON = {
	tv: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
	laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19"/>',
	phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
	watch: '<rect x="6.5" y="6.5" width="11" height="11" rx="3"/><path d="M9 6.5 9.5 3h5l.5 3.5M9 17.5l.5 3.5h5l.5-3.5"/>',
	plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
	wifi: '<path d="M2.5 8.8a14 14 0 0 1 19 0M5.6 12.3a9.5 9.5 0 0 1 12.8 0M8.8 15.6a5 5 0 0 1 6.4 0M12 19.2h.01"/>',
	ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 10"/>',
	warn: '<path d="M12 8.5v4.5M12 16.5h.01M10.3 4.2 2.7 17.4a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/>',
	bad: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
	na: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
	gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4-4"/>',
	chev: '<path d="m9 6 6 6-6 6"/>'
};
const svg = (k, cls) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${ICON[k]}</svg>`;
// one color per device, in list order; orange is kept for the 95% line
const COLORS = [ 'var(--blue)', 'var(--pink)', 'var(--teal)', 'var(--purple)', 'var(--indigo)', 'var(--green)', 'var(--brown)', 'var(--gray)' ];
const kindOf = n => /tv|bravia|roku|firestick|chromecast/i.test(n) ? 'tv' : /watch/i.test(n) ? 'watch'
	: /tapo|plug|strip|ldnio|bulb|switch|kasa/i.test(n) ? 'plug' : /laptop|ideapad|book|desktop|pc\b|thinkpad|vivobook|-pc/i.test(n) ? 'laptop'
	: /phone|oneplus|galaxy|iphone|realme|redmi|pixel|moto|vivo|oppo|poco/i.test(n) ? 'phone' : 'wifi';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const hm = ts => { const d = new Date(ts * 1000); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const MON = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];
const dmy = ts => { const d = new Date(ts * 1000); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const f1 = v => v >= 100 ? String(Math.round(v)) : (+v).toFixed(1);
const size = mb => mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
const hrs = m => m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
const lines = s => (s || '').split('\n').filter(l => l).map(l => l.split(','));
const nice = v => [ 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000 ].find(x => x >= v) || Math.ceil(v / 500) * 500;
const clamp = v => Math.max(1, Math.min(1000, Math.round(+v) || DEF));

if (!document.getElementById('inter-font'))
	document.head.appendChild(E('link', { id: 'inter-font', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap' }));

const CSS = `
.du{
 --bg:#F2F2F7;--bg2:#FFFFFF;--label:#000;--label2:#6C6C70;--label3:#8E8E93;--sep:rgba(60,60,67,.22);
 --fill:rgba(120,120,128,.2);--fill3:rgba(118,118,128,.12);--segon:#FFFFFF;--tint:#007AFF;--tintTx:#0040DD;--swon:#248A3D;
 --red:#D70015;--green:#248A3D;--orange:#C93400;--gray:#6C6C70;--blue:#0040DD;--purple:#8944AB;--indigo:#3634A3;--teal:#0071A4;--pink:#D30F45;--brown:#7F6545;
 --shadow:0 1px 2px rgba(0,0,0,.06),0 4px 14px rgba(0,0,0,.06);
 background:var(--bg);color:var(--label);border-radius:18px;padding:16px 16px 40px;margin:8px auto 24px;max-width:792px;position:relative;
 font:15px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;text-align:left;container-type:inline-size
}
:root[data-darkmode="true"] .du{
 --bg:#000;--bg2:#1C1C1E;--label:#FFF;--label2:#AEAEB2;--label3:#8E8E93;--sep:rgba(84,84,88,.6);
 --fill:rgba(120,120,128,.36);--fill3:rgba(118,118,128,.24);--segon:#636366;--tint:#0A84FF;--tintTx:#409CFF;--swon:#30D158;
 --red:#FF453A;--green:#30D158;--orange:#FF9F0A;--gray:#98989D;--blue:#0A84FF;--purple:#BF5AF2;--indigo:#7D7AFF;--teal:#40C8E0;--pink:#FF375F;--brown:#AC8E68;
 --shadow:0 1px 2px rgba(0,0,0,.5)
}
.du *{box-sizing:border-box}
.du button{all:unset;box-sizing:border-box;cursor:pointer}
.du input{all:unset;box-sizing:border-box}
.du :focus-visible{outline:3px solid color-mix(in srgb,var(--tint) 55%,transparent);outline-offset:2px}
.du .in{display:grid;gap:14px}
.du h2.lt{margin:6px 4px 0;font-size:32px;font-weight:700;letter-spacing:-.025em;line-height:1.1;color:var(--label);border:0;padding:0;background:none}
.du h2.lt small{display:block;font-size:15px;font-weight:400;letter-spacing:0;color:var(--label2);margin-top:4px}
.du .num{font-variant-numeric:tabular-nums}
.du .seg{display:flex;background:var(--fill3);border-radius:9px;padding:2px;gap:2px}
.du .seg button{display:block;flex:1;text-align:center;font-size:13px;font-weight:500;padding:6px 10px;border-radius:7px;white-space:nowrap;min-height:30px;color:var(--label)}
.du .seg button.on{background:var(--segon);box-shadow:0 3px 8px rgba(0,0,0,.12),0 3px 1px rgba(0,0,0,.04);font-weight:600}
.du .card{background:var(--bg2);border-radius:18px;box-shadow:var(--shadow);padding:14px 16px}
.du .cap{margin:0 0 6px;font-size:13px;font-weight:600;color:var(--label2);text-transform:uppercase;letter-spacing:.03em}
.du .foot{font-size:13px;color:var(--label2);line-height:1.4;margin:6px 16px 0}
.du .ico{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;flex:none;color:#fff}
.du .ico svg{width:20px;height:20px}
.du .empty{padding:24px 8px;text-align:center;color:var(--label2);font-size:15px;line-height:1.5}
.du .badge{font-size:12px;font-weight:600;padding:2px 7px;border-radius:6px;white-space:nowrap;background:color-mix(in srgb,var(--tint) 16%,transparent);color:var(--tintTx);display:inline-flex;gap:3px;align-items:center}
.du .badge svg{width:12px;height:12px}

.du .sw{width:51px;height:31px;border-radius:999px;background:var(--fill);position:relative;flex:none;transition:background .2s}
.du .sw::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 3px 8px rgba(0,0,0,.15),0 1px 1px rgba(0,0,0,.16);transition:transform .2s}
.du .sw::before{content:"";position:absolute;left:12px;top:10px;width:2px;height:11px;border-radius:1px;background:#fff;opacity:0}
.du .sw[aria-checked=true]{background:var(--swon)}
.du .sw[aria-checked=true]::after{transform:translateX(20px)}
.du .sw[aria-checked=true]::before{opacity:1}
.du .stp{display:inline-flex;align-items:center;gap:8px}
.du .stp .fld{display:flex;align-items:center;gap:4px;background:var(--fill3);border-radius:9px;padding:0 10px;height:36px}
.du .stp input{width:52px;text-align:right;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--label)}
.du .stp .fld span{font-size:15px;color:var(--label2)}
.du .stp .pm{display:flex;background:var(--fill3);border-radius:9px;overflow:hidden}
.du .stp .pm button{width:44px;height:36px;font-size:20px;display:grid;place-items:center;color:var(--label)}
.du .stp .pm button+button{border-left:1px solid var(--sep)}
.du .stp .fld:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--tint) 45%,transparent)}
.du .vd{display:flex;gap:8px;align-items:flex-start;font-size:14px;line-height:1.4;color:var(--label2)}
.du .vd svg{width:18px;height:18px;flex:none;margin-top:1px}
.du .vd.bad svg{color:var(--red)}.du .vd.warn svg{color:var(--orange)}.du .vd.ok svg{color:var(--green)}.du .vd.na svg{color:var(--gray)}
.du .vd b{color:var(--label);font-weight:600}
.du .chipb{font-size:13px;font-weight:600;color:var(--tintTx);background:color-mix(in srgb,var(--tint) 12%,transparent);border-radius:999px;padding:6px 12px;min-height:32px}
.du .chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.du .chip{border:1px solid var(--sep);background:var(--bg2);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:500;min-height:32px;display:inline-flex;gap:6px;align-items:center;white-space:nowrap;color:var(--label)}
.du .chip small{color:var(--label2);font-weight:400}
.du .chip svg{width:13px;height:13px}
.du .chip.on{background:var(--label);color:var(--bg2);border-color:transparent}
.du .chip.on small{color:inherit;opacity:.75}

.du .rn{display:flex;height:22px;border-radius:7px;overflow:hidden;background:var(--fill3);gap:2px}
.du .rn i{display:block;min-width:3px}
.du .rn-l{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;color:var(--label2);margin-top:8px}
.du .rn-l b{color:var(--label);font-weight:600;font-variant-numeric:tabular-nums}
.du .rn-l i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.du .dc{background:var(--bg2);border-radius:18px;box-shadow:var(--shadow);padding:14px 16px;display:grid;gap:12px}
.du .hb{display:flex;gap:12px;align-items:center;text-align:left;border-radius:12px;margin:-4px;padding:4px;width:calc(100% + 8px)}
.du .hb:hover{background:var(--fill3)}
.du .hb .tx{flex:1;min-width:0}
.du .hb .tx b{font-size:17px;font-weight:600;display:flex;gap:6px;align-items:center;min-width:0}
.du .hb .tx b span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.du .hb .tx > span{font-size:13px;color:var(--label2)}
.du .hb .now{text-align:right;line-height:1.15}
.du .hb .now b{font-size:22px;font-variant-numeric:tabular-nums}
.du .hb .now span{font-size:12px;color:var(--label2)}
.du .hb > svg{width:18px;height:18px;color:var(--label3);flex:none}
.du .spark{display:block;width:100%;height:34px}
.du .sc{position:relative;padding:18px 0 20px;touch-action:pan-y}
.du .sc .tr{position:relative;height:16px;border-radius:8px;background:var(--fill3);overflow:hidden}
.du .sc.big .tr{height:26px;border-radius:9px}
.du .sc .tr i{position:absolute;top:0;bottom:0;left:0}
.du .sc .ax{position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:space-between;font-size:11px;color:var(--label2);font-variant-numeric:tabular-nums}
.du .sc .mk{position:absolute;top:6px;bottom:14px;width:30px;margin-left:-15px;cursor:ew-resize;touch-action:none;border-radius:6px}
.du .sc .mk::before{content:"";position:absolute;left:13px;top:6px;bottom:0;width:4px;border-radius:2px;background:var(--label);box-shadow:0 0 0 2px var(--bg2)}
.du .sc .mk::after{content:attr(data-l) " Mbps";position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:12px;font-weight:700;color:var(--bg2);background:var(--label);padding:1px 7px;border-radius:6px;white-space:nowrap}
.du .sc .mk.drag::after{font-size:14px;padding:3px 9px;top:-18px}
.du .sc .sug{position:absolute;top:14px;bottom:16px;width:0;border-left:2px dashed var(--label2)}
.du .sc .sug span{position:absolute;top:-14px;left:0;transform:translateX(-50%);font-size:11px;color:var(--label2);white-space:nowrap}
.du .leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--label2)}
.du .leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.du .ctl{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between;border-top:1px solid var(--sep);padding-top:12px}
.du .ctl label{display:flex;gap:12px;align-items:center;font-size:16px;font-weight:500}
.du .list{background:var(--bg2);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}
.du .row{display:flex;align-items:center;gap:12px;padding:10px 14px;min-height:52px;position:relative}
.du .row+.row::before,.du .row+.sub::before,.du .sub+.row::before{content:"";position:absolute;top:0;left:60px;right:0;border-top:1px solid var(--sep)}
.du .row .tx{flex:1;min-width:0;text-align:left}
.du .row .tx b{display:block;font-weight:500;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.du .row .tx span{display:block;font-size:13px;color:var(--label2)}
.du .sub{position:relative;padding:8px 14px 12px 60px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.du .back{color:var(--tintTx);font-size:17px;min-height:44px;display:inline-flex;align-items:center;gap:2px;justify-self:start}
.du .back svg{width:20px;height:20px;transform:scaleX(-1)}
.du .wid{border-radius:22px;padding:16px 18px;color:#fff;background:linear-gradient(150deg,#1d6fd6,#0b4aa0);display:grid;gap:6px}
.du .wid.idle{background:linear-gradient(150deg,#636366,#3a3a3c)}
.du .wid .w1{font-size:13px;font-weight:600;opacity:.9;text-transform:uppercase;letter-spacing:.03em;display:flex;justify-content:space-between;gap:8px}
.du .wid .wl{background:rgba(255,255,255,.2);border-radius:6px;padding:1px 7px;text-transform:none;letter-spacing:0}
.du .wid .w2{font-size:34px;font-weight:700;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}
.du .wid .w3{font-size:15px;opacity:.92}
.du .kpi{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--sep);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}
.du .kpi div{background:var(--bg2);padding:10px 12px}
.du .kpi span{font-size:13px;color:var(--label2);display:block}
.du .kpi b{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.du .kpi small{font-size:13px;color:var(--label2)}
@container (min-width:600px){.du .kpi{grid-template-columns:repeat(3,1fr)}}
.du svg.ch{display:block;width:100%;height:auto;touch-action:pan-y}
.du svg.ch text{font-size:11px;fill:var(--label2);font-family:inherit}
.du .read{font-size:13px;color:var(--label2);min-height:18px;margin-top:6px;font-variant-numeric:tabular-nums}
.du .read b{color:var(--label)}
.du .enter{animation:du-in .28s cubic-bezier(.2,.8,.2,1)}
.du .enter.bk{animation-name:du-back}
@keyframes du-in{from{transform:translateX(40px);opacity:0}}
@keyframes du-back{from{transform:translateX(-40px);opacity:0}}
@media (prefers-reduced-motion:reduce){.du .enter,.du .sw,.du .sw::after{animation:none;transition:none}}
.du .toast{position:sticky;bottom:12px;margin:0 auto;width:max-content;max-width:100%;display:flex;gap:14px;align-items:center;background:var(--label);color:var(--bg2);border-radius:999px;padding:10px 16px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:2}
.du .toast button{color:inherit;font-weight:700;text-decoration:underline}
`;

return view.extend({
	load() {
		return callGet(24);
	},

	render(res) {
		this.st = { range: 24, view: 'list', sel: null, toast: '', undo: null, anim: '' };
		this.lim = {};
		const root = E('div', { 'class': 'du' });
		root.innerHTML = `<style>${CSS}</style><div data-r="main"></div><div data-r="toast"></div>`;
		this.root = root;
		this.main = root.querySelector('[data-r=main]');
		this.tst = root.querySelector('[data-r=toast]');

		root.addEventListener('click', ev => {
			const t = ev.target.closest('[data-a]');
			if (t && root.contains(t)) this.act(t.dataset.a);
		});
		root.addEventListener('change', ev => {
			const m = ev.target.dataset.in;
			if (m) this.setLimit(m, true, clamp(ev.target.value));
		});
		root.addEventListener('keydown', ev => {
			if (ev.key === 'Enter' && ev.target.dataset.in) ev.target.blur();
			// the limit mark: arrows 1 Mbps, with Shift 5, Home / End to the ends
			const mk = ev.target.closest('[data-drag]');
			if (!mk) return;
			const m = mk.dataset.drag, v = this.lim[m].v, top = +mk.closest('.sc').dataset.top, step = ev.shiftKey ? 5 : 1;
			const to = { ArrowRight: v + step, ArrowUp: v + step, ArrowLeft: v - step, ArrowDown: v - step, Home: 1, End: top }[ev.key];
			if (to == null) return;
			ev.preventDefault();
			this.setLimit(m, true, Math.max(1, Math.min(top, to)));
		});
		root.addEventListener('pointerdown', ev => this.drag(ev));
		// the chart readout: the minute (hour) under the pointer, and what the limit makes of it
		root.addEventListener('pointermove', ev => {
			const c = ev.target.closest('svg.ch'), ch = this.chartData;
			if (!c || !ch) return;
			const r = c.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * ch.W, k = Math.floor((x - ch.L) / ch.PW * ch.n);
			if (!(k >= 0 && k < ch.n)) return;
			const v = ch.vals[k], L = this.lim[ch.mac], ts = ch.from + k * ch.bs, xh = c.querySelector('.xh');
			xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
			root.querySelector('.read').innerHTML = `<b>${ch.bs === 60 ? hm(ts) : dmy(ts) + ' ' + hm(ts)}</b> · ${v ? f1(v) + ' Mbps' : 'idle'}${ch.extra[k] || ''}`
				+ (L.on && v > L.v ? ` · with the limit: <b>${L.v} Mbps</b> (${Math.round((1 - L.v / v) * 100)}% slower)` : L.on && v ? ' · under the limit' : '');
		});

		this.update(res);
		// history once a minute (the logger writes a row a minute), the live speed every 10 s
		let tick = 0;
		poll.add(() => this.dragging ? Promise.resolve() : ++tick % 6 ? this.fetchLive() : this.fetch(), 10);
		return root;
	},

	fetch() {
		return callGet(this.st.range).then(r => this.update(r));
	},

	fetchLive() {
		return callLive().then(r => {
			const now = this.parseNow(r.now);
			(this.devs || []).forEach(d => d.now = now[d.mac] || null);
			this.draw();
		});
	},

	parseNow(s) {
		const now = {};
		lines(s).forEach(f => now[f[1]] = f.map((x, i) => i === 1 ? x : +x));
		return now;
	},

	update(res) {
		const sums = {}, now = this.parseNow(res.now), rows = {};
		lines(res.sums).forEach(f => sums[f[0]] = f.slice(1).map(Number));
		lines(res.rows).forEach(f => (rows[f[1]] = rows[f[1]] || []).push(f.map((x, i) => i === 1 ? x : +x)));
		// a change sent to the router wins over an older read
		const lim = {};
		lines(res.lims).forEach(f => lim[f[0]] = { on: f[1] === '1', v: +f[2] || DEF });
		Object.keys(this.lim).forEach(m => { if (this.lim[m].pending) lim[m] = this.lim[m]; });
		this.lim = lim;

		this.devs = lines(res.devs).map((f, i) => {
			const s = sums[f[0]] || [ 0, 0, 0, 0, 0, +f[2] || 0 ];
			const d = { mac: f[0], name: f[1], kind: kindOf(f[1]), c: COLORS[i % COLORS.length], use: s[0], med: s[1], p95: s[2], max: s[3], peak: s[4], mb: s[5],
				now: now[f[0]] || null, rows: rows[f[0]] || [] };
			d.sug = d.use >= 30 ? Math.ceil(d.p95 * 1.5 / 5) * 5 : 0;
			if (!this.lim[d.mac]) this.lim[d.mac] = { on: false, v: DEF };
			return d;
		});
		if (!this.st.sel || !this.dev(this.st.sel)) {
			const tv = this.devs.find(d => d.kind === 'tv');
			this.st.sel = (tv || this.devs[0] || {}).mac;
		}
		this.draw();
	},

	dev(m) { return (this.devs || []).find(d => d.mac === m); },

	act(a) {
		const st = this.st, i = a.indexOf(':'), k = i < 0 ? a : a.slice(0, i), rest = i < 0 ? '' : a.slice(i + 1);
		// "<cmd>:<mac>:<arg>"; a mac is 17 characters
		const m = rest.slice(0, 17), arg = rest.slice(18);
		if (k === 'range') { st.range = +rest; return this.fetch(); }
		if (k === 'det') { st.listTop = this.scrollY(); st.sel = m; st.view = 'det'; st.anim = 'in'; st.scrollTo = this.root.offsetTop; }
		else if (k === 'sel') { st.sel = m; }
		else if (k === 'back') { st.view = 'list'; st.anim = 'bk'; st.scrollTo = st.listTop; }
		else if (k === 'tog') return this.setLimit(m, !this.lim[m].on, this.lim[m].v);
		else if (k === 'inc') return this.setLimit(m, true, clamp(this.lim[m].v + +arg));
		else if (k === 'seton') return this.setLimit(m, true, +arg);
		else if (k === 'undo') { const u = st.undo; st.undo = null; this.showToast(''); if (u) this.setLimit(u.mac, u.prev.on, u.prev.v, true); return; }
		this.draw();
	},

	scrollY() { return window.scrollY || document.documentElement.scrollTop; },

	// applied at once on the router; the page shows it right away and puts it back if the router says no
	setLimit(m, on, v, isUndo) {
		const prev = { on: this.lim[m].on, v: this.lim[m].v }, name = (this.dev(m) || { name: m }).name;
		if (prev.on === on && prev.v === v) return;
		this.lim[m] = { on, v, pending: true };
		if (!isUndo) this.st.undo = { mac: m, prev };
		this.draw();
		return callSet(m, on, v).then(r => {
			if (!r || r.result !== 'ok') throw new Error(r && r.result || 'no answer');
			this.lim[m].pending = false;
			this.showToast(isUndo ? `${esc(name)}: back to ${on ? v + ' Mbps' : 'no limit'}`
				: !on ? `${esc(name)}: no limit` : prev.on ? `${esc(name)}: ${v} Mbps` : `${esc(name)} limited to ${v} Mbps`, !isUndo);
		}).catch(e => {
			this.lim[m] = prev;
			this.st.undo = null;
			this.showToast(`Couldn't change the limit of ${esc(name)}: ${esc(e.message)}`, false);
			this.draw();
		});
	},

	showToast(html, undo) {
		clearTimeout(this.tt);
		this.tst.innerHTML = html ? `<div class="toast" role="status">${html}${undo ? '<button data-a="undo">Undo</button>' : ''}</div>` : '';
		if (html) this.tt = setTimeout(() => { this.tst.innerHTML = ''; this.st.undo = null; }, 6000);
	},

	// drag the limit mark: only the mark and the field move while dragging, one change on release
	drag(ev) {
		const mk = ev.target.closest('[data-drag]');
		if (!mk) return;
		const m = mk.dataset.drag, sc = mk.closest('.sc'), top = +sc.dataset.top, r = sc.querySelector('.tr').getBoundingClientRect();
		ev.preventDefault(); mk.setPointerCapture(ev.pointerId); mk.classList.add('drag'); mk.focus({ preventScroll: true });
		this.dragging = true;
		let v = this.lim[m].v;
		const move = e => {
			v = Math.max(1, Math.min(top, Math.round((e.clientX - r.left) / r.width * top)));
			mk.style.left = (v / top * 100) + '%'; mk.dataset.l = v;
			mk.setAttribute('aria-valuenow', v); mk.setAttribute('aria-valuetext', v + ' Mbps');
			const f = this.root.querySelector(`input[data-in="${m}"]`); if (f) f.value = v;
		};
		const up = () => {
			mk.removeEventListener('pointermove', move); mk.removeEventListener('pointerup', up); mk.removeEventListener('pointercancel', up);
			this.dragging = false;
			if (v !== this.lim[m].v) this.setLimit(m, true, v); else this.draw();
		};
		mk.addEventListener('pointermove', move); mk.addEventListener('pointerup', up); mk.addEventListener('pointercancel', up);
	},

	// replaces the markup only when it changed, so the poll doesn't disturb anything; keeps focus
	draw() {
		const html = this.st.view === 'det' && this.dev(this.st.sel) ? this.detail() : this.list();
		if (this.main._html === html) return;
		const ae = document.activeElement, fk = ae && this.main.contains(ae) ? (ae.dataset.drag ? `[data-drag="${ae.dataset.drag}"]` : ae.dataset.a ? `[data-a="${ae.dataset.a}"]` : null) : null;
		this.main._html = html;
		this.main.innerHTML = html;
		this.st.anim = '';
		if (this.st.scrollTo != null) { window.scrollTo(0, this.st.scrollTo); this.st.scrollTo = null; }
		if (fk) { const f = this.main.querySelector(fk); f && f.focus({ preventScroll: true }); }
	},

	/* ---------- pieces ---------- */

	ico(d) { return `<span class="ico" style="background:${d.c}">${svg(d.kind)}</span>`; },
	sw(on, a, lbl) { return `<button class="sw" role="switch" aria-checked="${on}" aria-label="${esc(lbl)}" data-a="${a}"></button>`; },
	stepper(m, v) {
		return `<span class="stp"><span class="fld"><input type="number" inputmode="numeric" min="1" max="1000" value="${v}" data-in="${m}" aria-label="Max speed in Mbps"><span>Mbps</span></span>
			<span class="pm"><button data-a="inc:${m}:-5" aria-label="5 Mbps less">−</button><button data-a="inc:${m}:5" aria-label="5 Mbps more">+</button></span></span>`;
	},
	sugBtn(d, L) { return d.sug && (!L.on || L.v !== d.sug) ? `<button class="chipb" data-a="seton:${d.mac}:${d.sug}">${L.on ? 'Use' : 'Limit to'} ${d.sug} Mbps</button>` : ''; },
	rangeSeg() { return `<div class="seg" role="group" aria-label="Time range">${RANGES.map(([ h, l ]) => `<button data-a="range:${h}" class="${this.st.range === h ? 'on' : ''}" aria-pressed="${this.st.range === h}">${l}</button>`).join('')}</div>`; },

	// what a limit means for this device, in words and a glyph (color is only extra)
	verdict(d, L) {
		if (!L.on) return d.sug ? `<div class="vd na">${svg('na')}<span>No limit. If you set one, <b>${d.sug} Mbps</b> keeps it smooth (95% of its in-use minutes were under ${f1(d.p95)} Mbps).</span></div>`
			: `<div class="vd na">${svg('na')}<span>No limit. Too little use logged to suggest one yet.</span></div>`;
		if (d.use < BUSY) return `<div class="vd ok">${svg('ok')}<span>Limited to <b>${L.v} Mbps</b>. It has hardly used more than 1 Mbps, so it won't notice.</span></div>`;
		if (L.v < d.med) return `<div class="vd bad">${svg('bad')}<span><b>${L.v} Mbps is below its typical ${f1(d.med)} Mbps.</b> Video will buffer or fall to a lower quality.</span></div>`;
		if (L.v < d.p95) return `<div class="vd warn">${svg('warn')}<span><b>${L.v} Mbps covers its typical use, not its busy minutes</b> (95%: ${f1(d.p95)} Mbps). 4K may step down to HD.</span></div>`;
		return `<div class="vd ok">${svg('ok')}<span><b>${L.v} Mbps is enough.</b> 95% of its minutes were under ${f1(d.p95)} Mbps; only the buffer bursts (up to ${f1(d.peak)}) get slower.</span></div>`;
	},

	// the plotted series of a device: minute averages, or beyond 48 h the hour's in-use average
	series(d) {
		const hourly = this.st.range > 48, bs = hourly ? 3600 : 60, n = this.st.range * 3600 / bs, from = Math.floor(Date.now() / 1000) - this.st.range * 3600;
		const vals = new Array(n).fill(0), extra = new Array(n).fill('');
		d.rows.forEach(r => {
			const k = Math.floor((r[0] + (hourly ? 1800 : 0) - from) / bs);
			if (k < 0 || k >= n) return;
			vals[k] = r[2];
			extra[k] = hourly ? ` (in use ${r[5]} min, busiest minute ${f1(r[6])})` : ` (fastest 10 s ${f1(r[3])})`;
		});
		return { vals, extra, bs, n, from };
	},

	// need-vs-limit scale; with the limit on, its mark is a slider (drag or arrow keys)
	scale(d, L, big) {
		const top = nice(Math.max(d.max, d.sug, L.on ? L.v : 0, 10) * 1.15), pc = v => Math.min(100, v / top * 100).toFixed(1) + '%';
		return `<div class="sc ${big ? 'big' : ''}" data-top="${top}">
			<div class="tr" role="img" aria-label="Typical ${f1(d.med)}, 95% ${f1(d.p95)}, busiest minute ${f1(d.max)} Mbps"><i style="width:${pc(d.max)};background:color-mix(in srgb,${d.c} 25%,transparent)"></i><i style="width:${pc(d.p95)};background:color-mix(in srgb,${d.c} 55%,transparent)"></i><i style="width:${pc(d.med)};background:${d.c}"></i></div>
			${L.on ? `<span class="mk" role="slider" tabindex="0" data-drag="${d.mac}" data-l="${L.v}" style="left:${pc(L.v)}" aria-label="Speed limit for ${esc(d.name)}, drag or use the arrow keys" aria-valuemin="1" aria-valuemax="${top}" aria-valuenow="${L.v}" aria-valuetext="${L.v} Mbps"></span>`
				: d.sug ? `<span class="sug" style="left:${pc(d.sug)}"><span>suggested ${d.sug}</span></span>` : ''}
			<div class="ax"><span>0</span><span>${top / 2}</span><span>${top} Mbps</span></div></div>
			<div class="leg"><span><i style="background:${d.c}"></i>Typical ${f1(d.med)}</span><span><i style="background:color-mix(in srgb,${d.c} 55%,transparent)"></i>95% ${f1(d.p95)}</span><span><i style="background:color-mix(in srgb,${d.c} 25%,transparent)"></i>Busiest ${f1(d.max)}</span>${L.on ? `<span><i style="background:var(--label);width:4px"></i>Limit ${L.v}</span>` : ''}</div>`;
	},

	// the range in 96 steps, with the limit as a dashed line
	spark(d, L) {
		const s = this.series(d), w = s.n / 96;
		const b = Array.from({ length: 96 }, (_, k) => { let a = 0; for (let j = Math.floor(k * w); j < Math.floor((k + 1) * w); j++) a += s.vals[j]; return a / Math.max(1, Math.floor((k + 1) * w) - Math.floor(k * w)); });
		const top = Math.max(...b, L.on ? L.v : 0, 1) * 1.1, Y = v => (32 - v / top * 30).toFixed(1);
		const p = b.map((v, k) => `${k ? 'L' : 'M'}${(k / 95 * 300).toFixed(1)} ${Y(v)}`).join('');
		return `<svg class="spark" viewBox="0 0 300 34" preserveAspectRatio="none" aria-hidden="true"><path d="${p}L300 34L0 34Z" fill="color-mix(in srgb,${d.c} 18%,transparent)"/><path d="${p}" fill="none" stroke="${d.c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${L.on ? `<line x1="0" x2="300" y1="${Y(L.v)}" y2="${Y(L.v)}" stroke="var(--label)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>` : ''}</svg>`;
	},

	// the detail chart: the 95% line, the limit, and the part it would cut hatched
	chart(d, L) {
		const s = this.series(d), W = 720, H = 200, Lp = 34, T = 8, PW = W - Lp - 4, PH = H - T - 22, n = s.n, hourly = s.bs > 60;
		const lim = L.on ? L.v : 0, top = nice(Math.max(...s.vals, d.p95, lim, 4) * 1.12);
		const X = i => (Lp + i / n * PW).toFixed(1), Y = v => (T + PH - Math.min(v, top) / top * PH).toFixed(1);
		let p = `M${X(0)} ${Y(0)}`, prev = 0;
		s.vals.forEach((v, i) => { if (v !== prev) { p += `H${X(i)}V${Y(v)}`; prev = v; } });
		p += `H${X(n)}V${Y(0)}Z`;
		const grid = [ 0, .5, 1 ].map(k => `<line x1="${Lp}" x2="${W - 4}" y1="${Y(top * k)}" y2="${Y(top * k)}" stroke="var(--sep)"/><text x="${Lp - 6}" y="${+Y(top * k) + 4}" text-anchor="end">${top * k}</text>`).join('');
		const ticks = [ 0, .25, .5, .75, 1 ].map((k, j) => { const ts = s.from + k * n * s.bs; return `<text x="${X(k * n)}" y="${H - 5}" text-anchor="${j === 0 ? 'start' : j === 4 ? 'end' : 'middle'}">${j === 4 ? 'now' : hourly ? dmy(ts) : hm(ts)}</text>`; }).join('');
		const p95 = d.p95 ? `<line x1="${Lp}" x2="${W - 4}" y1="${Y(d.p95)}" y2="${Y(d.p95)}" stroke="var(--orange)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${Lp + 4}" y="${+Y(d.p95) - 5}" style="fill:var(--orange)">95%: ${f1(d.p95)}</text>` : '';
		const cut = lim ? `<defs><pattern id="du-h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--red)" stroke-width="2"/></pattern><clipPath id="du-k"><rect x="0" y="0" width="${W}" height="${Y(lim)}"/></clipPath></defs>
			<path d="${p}" fill="url(#du-h)" clip-path="url(#du-k)" opacity=".55"/>
			<line x1="${Lp}" x2="${W - 4}" y1="${Y(lim)}" y2="${Y(lim)}" stroke="var(--tint)" stroke-width="2"/><text x="${W - 6}" y="${+Y(lim) - 5}" text-anchor="end" style="fill:var(--tintTx);font-weight:700">Limit ${lim}</text>` : '';
		this.chartData = { mac: d.mac, W, L: Lp, PW, n, bs: s.bs, from: s.from, vals: s.vals, extra: s.extra };
		return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.name)}: download, last ${this.st.range} hours. 95% of in-use minutes under ${f1(d.p95)} Mbps${lim ? `, limit ${lim} Mbps` : ''}.">${grid}
			<path d="${p}" fill="color-mix(in srgb,${d.c} 24%,transparent)" stroke="${d.c}" stroke-width="1.4"/>${cut}${p95}${ticks}<line class="xh" x1="0" x2="0" y1="${T}" y2="${T + PH}" stroke="var(--label)" stroke-width="1" visibility="hidden"/></svg>`;
	},

	/* ---------- pages ---------- */

	list() {
		if (!this.devs.length) return `<div class="in"><h2 class="lt">Device Usage</h2><div class="card empty">No Wi-Fi traffic logged yet. The log fills every minute while a device is online.</div></div>`;
		const live = this.devs.filter(d => d.now && d.now[2] >= .1).sort((a, b) => b.now[2] - a.now[2]), tot = live.reduce((a, d) => a + d.now[2], 0);
		const n = this.devs.filter(d => this.lim[d.mac].on).length, busy = this.devs.filter(d => d.use >= BUSY), quiet = this.devs.filter(d => d.use < BUSY);
		const rl = this.st.range === 24 ? 'last 24 hours' : 'last ' + RANGES.find(r => r[0] === this.st.range)[1].toLowerCase();
		return `<div class="in ${this.st.anim === 'bk' ? 'enter bk' : ''}">
			<h2 class="lt">Device Usage<small>How much each device needs, and what its limit allows</small></h2>
			<div class="card"><p class="cap" style="display:flex;justify-content:space-between;gap:8px"><span>Right Now</span><span class="num" style="text-transform:none;letter-spacing:0">${f1(tot)} Mbps · ${n ? n + ' limited' : 'no limits'}</span></p>
				${live.length ? `<div class="rn" role="img" aria-label="${esc(live.map(d => d.name + ' ' + f1(d.now[2]) + ' Mbps').join(', '))}">${live.map(d => `<i style="flex:${d.now[2]};background:${d.c}"></i>`).join('')}</div>
				<div class="rn-l">${live.map(d => `<span><i style="background:${d.c}"></i>${esc(d.name)} <b>${f1(d.now[2])}</b>${this.lim[d.mac].on ? ` · max ${this.lim[d.mac].v}` : ''}</span>`).join('')}</div>`
				: '<p class="foot" style="margin:0">No device is downloading right now.</p>'}</div>
			${this.rangeSeg()}
			${busy.map(d => { const L = this.lim[d.mac]; return `<div class="dc">
				<button class="hb" data-a="det:${d.mac}" aria-label="${esc(d.name)} details">${this.ico(d)}<span class="tx"><b><span>${esc(d.name)}</span>${L.on ? `<span class="badge">${svg('gauge')}${L.v}</span>` : ''}</b><span>In use ${hrs(d.use)} · ${size(d.mb)}</span></span><span class="now"><b>${d.now ? f1(d.now[2]) : '0'}</b><br><span>Mbps now</span></span>${svg('chev')}</button>
				${this.spark(d, L)}
				${this.scale(d, L)}
				<div class="ctl"><label>${this.sw(L.on, 'tog:' + d.mac, 'Speed limit for ' + d.name)} Speed Limit</label>${L.on ? this.stepper(d.mac, L.v) : this.sugBtn(d, L)}</div>
				${this.verdict(d, L)}${L.on && this.sugBtn(d, L) ? `<div>${this.sugBtn(d, L)}</div>` : ''}</div>`; }).join('')}
			${quiet.length ? `<div><p class="cap" style="margin-left:16px">Quiet Devices</p><div class="list">${quiet.map(d => { const L = this.lim[d.mac]; return `<div class="row">${this.ico(d)}<button class="tx" data-a="det:${d.mac}"><b>${esc(d.name)}</b><span>${size(d.mb)} · ${rl}${L.on ? ' · limited to ' + L.v + ' Mbps' : ''}</span></button>${this.sw(L.on, 'tog:' + d.mac, 'Speed limit for ' + d.name)}</div>
				${L.on ? `<div class="sub"><span style="font-size:16px">Max Speed</span>${this.stepper(d.mac, L.v)}</div>` : ''}`; }).join('')}</div>
				<p class="foot">These hardly went above 1 Mbps, so there is no need to draw yet. They can still get a limit.</p></div>` : ''}
			<p class="foot">A limit caps the device's download from the internet and the LAN over Wi-Fi, from the moment you change it. Upload is not limited. A speed test under a limit reads close to the number, a little lower on a busy or weak Wi-Fi link.</p>
		</div>`;
	},

	detail() {
		const d = this.dev(this.st.sel), L = this.lim[d.mac], nw = d.now ? d.now[2] : 0;
		return `<div class="in ${this.st.anim === 'in' ? 'enter' : ''}">
			<button class="back" data-a="back">${svg('chev')}Devices</button>
			<div class="chips" role="group" aria-label="Device">${this.devs.map(x => `<button class="chip ${x.mac === d.mac ? 'on' : ''}" data-a="sel:${x.mac}" aria-pressed="${x.mac === d.mac}">${this.lim[x.mac].on ? svg('gauge') : ''}${esc(x.name)} <small>${size(x.mb)}</small></button>`).join('')}</div>
			<h2 class="lt" style="margin-top:0">${esc(d.name)}<small class="num">${esc(d.mac)}</small></h2>
			<div class="wid ${nw >= USE ? '' : 'idle'}" role="status"><div class="w1"><span>Now</span>${L.on ? `<span class="wl">Limited · ${L.v} Mbps</span>` : ''}</div>
				<div class="w2">${d.now ? f1(nw) + ' Mbps' : 'Idle'}</div>
				<div class="w3">${d.now ? `last 10 s · up ${f1(d.now[4])} Mbps` : 'nothing downloading right now'}</div></div>
			<div class="dc"><p class="cap" style="margin:0">Need vs Limit</p>
				${d.use >= BUSY ? this.scale(d, L, true) : '<p class="foot" style="margin:0">Too little use to draw its need yet.</p>'}
				<div class="ctl"><label>${this.sw(L.on, 'tog:' + d.mac, 'Speed limit for ' + d.name)} Speed Limit</label>${L.on ? this.stepper(d.mac, L.v) : ''}</div>
				${this.verdict(d, L)}${this.sugBtn(d, L) ? `<div>${this.sugBtn(d, L)}</div>` : ''}</div>
			${this.rangeSeg()}
			<div class="card"><p class="cap">Download, Mbps ${this.st.range > 48 ? '(hourly, in-use minutes)' : '(per minute)'}</p>${this.chart(d, L)}<div class="read">Move over the chart to read a ${this.st.range > 48 ? 'hour' : 'minute'}</div></div>
			<div class="kpi">
				<div><span>In Use</span><b>${hrs(d.use)}</b> <small>≥ ${USE} Mbps</small></div>
				<div><span>Typical</span><b>${f1(d.med)}</b> <small>Mbps median</small></div>
				<div><span>95% of Minutes</span><b>${f1(d.p95)}</b> <small>Mbps or less</small></div>
				<div><span>Busiest Minute</span><b>${f1(d.max)}</b> <small>Mbps</small></div>
				<div><span>Fastest 10 s</span><b>${f1(d.peak)}</b> <small>Mbps burst</small></div>
				<div><span>Downloaded</span><b>${size(d.mb)}</b></div></div>
		</div>`;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
