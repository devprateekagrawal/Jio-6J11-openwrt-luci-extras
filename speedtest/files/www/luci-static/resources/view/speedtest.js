'use strict';
'require view';
'require rpc';
'require poll';

// Speed Test: the router measures its own internet line to Cloudflare, IPv4 then
// IPv6: ping, download, upload (backend /usr/bin/speedtest.sh, which runs the
// test as its own process, so closing this page doesn't stop or break it).
// Layout = prototype 8 in prototypes/speed-test-prototypes.html next to the
// README: control card, IPv4 vs IPv6 table with the answer on top, a Download |
// Upload chart (segmented control, also swipeable), recent tests. The page is
// patched in place on every redraw (morph), so the chart keeps its scroll, focus
// and a swipe in progress while the test updates it every second. Markup is built
// from strings, so every text from the router goes through esc().

const callStatus = rpc.declare({ object: 'speedtest', method: 'status' });
const callHist = rpc.declare({ object: 'speedtest', method: 'history' });
const callStart = rpc.declare({ object: 'speedtest', method: 'start', params: [ 'which' ] });
const callStop = rpc.declare({ object: 'speedtest', method: 'stop' });

const PR = { v4: { name: 'IPv4', c: 'var(--v4)' }, v6: { name: 'IPv6', c: 'var(--v6)' } };
const PH = { ping: 'Ping', down: 'Download', up: 'Upload' };
const WORDS = { ping: 'Measuring ping', down: 'Downloading', up: 'Uploading' };
const LEN = { ping: 2, down: 10, up: 10 };   // seconds per step, as in speedtest.sh (ping ~2 s)
const CITY = { BOM: 'Mumbai', DEL: 'New Delhi', MAA: 'Chennai', BLR: 'Bengaluru', HYD: 'Hyderabad', CCU: 'Kolkata', AMD: 'Ahmedabad', COK: 'Kochi', NAG: 'Nagpur', PAT: 'Patna', IXC: 'Chandigarh', SIN: 'Singapore' };
const ICON = {
	down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
	up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
	ping: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2h5"/>',
	ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
	warn: '<path d="M12 8.5v4.5M12 16.5h.01M10.3 4.2 2.7 17.4a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/>'
};
const svg = (k, cls) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${ICON[k]}</svg>`;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const MON = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];
const f1 = v => v >= 100 ? String(Math.round(v)) : (+v).toFixed(1);
const size = mb => mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${Math.round(mb)} MB`;
const nice = v => [ 10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000 ].find(x => x >= v) || Math.ceil(v / 500) * 500;
const num = x => x === '' || x === '-' || x == null || isNaN(+x) ? null : +x;
// "Today 11:24", "Yesterday 21:05", "29 Oct 22:40"
function when(ts) {
	const d = new Date(ts * 1000), t = new Date(), y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
	const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
	return { d: same(d, t) ? 'Today' : same(d, y) ? 'Yesterday' : `${d.getDate()} ${MON[d.getMonth()]}`, t: `${p2(d.getHours())}:${p2(d.getMinutes())}` };
}

if (!document.getElementById('inter-font'))
	document.head.appendChild(E('link', { id: 'inter-font', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap' }));

const CSS = `
.sp{
 --bg:#F2F2F7;--bg2:#FFFFFF;--label:#000;--label2:#6C6C70;--label3:#8E8E93;--sep:rgba(60,60,67,.22);
 --fill:rgba(120,120,128,.2);--fill3:rgba(118,118,128,.12);--segon:#FFFFFF;--tint:#007AFF;--tintTx:#0040DD;--btn:#0062CC;
 --red:#D70015;--green:#248A3D;--orange:#C93400;--v4:#3634A3;--v6:#0071A4;
 --shadow:0 1px 2px rgba(0,0,0,.06),0 4px 14px rgba(0,0,0,.06);
 background:var(--bg);color:var(--label);border-radius:18px;padding:16px 16px 40px;margin:8px auto 24px;max-width:960px;position:relative;
 font:15px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;text-align:left;container-type:inline-size
}
:root[data-darkmode="true"] .sp{
 --bg:#000;--bg2:#1C1C1E;--label:#FFF;--label2:#AEAEB2;--label3:#8E8E93;--sep:rgba(84,84,88,.6);
 --fill:rgba(120,120,128,.36);--fill3:rgba(118,118,128,.24);--segon:#636366;--tint:#0A84FF;--tintTx:#409CFF;--btn:#0A6CDB;
 --red:#FF453A;--green:#30D158;--orange:#FF9F0A;--v4:#7D7AFF;--v6:#40C8E0;
 --shadow:0 1px 2px rgba(0,0,0,.5)
}
.sp *{box-sizing:border-box}
.sp button{all:unset;box-sizing:border-box;cursor:pointer}
.sp :focus-visible{outline:3px solid color-mix(in srgb,var(--tint) 55%,transparent);outline-offset:2px}
.sp .in{display:grid;gap:14px}
.sp h2.lt{margin:6px 4px 0;font-size:32px;font-weight:700;letter-spacing:-.025em;line-height:1.1;color:var(--label);border:0;padding:0;background:none}
.sp h2.lt small{display:block;font-size:15px;font-weight:400;letter-spacing:0;color:var(--label2);margin-top:4px}
.sp .seg{display:flex;background:var(--fill3);border-radius:9px;padding:2px;gap:2px}
.sp .seg button{display:block;flex:1;text-align:center;font-size:13px;font-weight:500;padding:6px 10px;border-radius:7px;white-space:nowrap;min-height:30px;color:var(--label)}
.sp .seg button.on{background:var(--segon);box-shadow:0 3px 8px rgba(0,0,0,.12),0 3px 1px rgba(0,0,0,.04);font-weight:600}
.sp .seg button[disabled]{opacity:.45;cursor:default}
.sp .card{background:var(--bg2);border-radius:18px;box-shadow:var(--shadow);padding:14px 16px;min-width:0}
.sp .cap{margin:0 0 6px;font-size:13px;font-weight:600;color:var(--label2);text-transform:uppercase;letter-spacing:.03em}
.sp .foot{font-size:13px;color:var(--label2);line-height:1.4;margin:6px 16px 0}
.sp .btnp{background:var(--btn);color:#fff;font-weight:600;font-size:15px;border-radius:999px;padding:0 22px;min-height:44px;display:inline-flex;align-items:center;white-space:nowrap}
.sp .btns{background:var(--fill3);color:var(--red);font-weight:600;font-size:15px;border-radius:999px;padding:0 22px;min-height:44px;display:inline-flex;align-items:center;white-space:nowrap}
.sp .btnp:hover,.sp .btns:hover{filter:brightness(1.08)}
.sp .ctl{display:grid;gap:12px}
.sp .ctlrow{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.sp .ctlrow .seg{flex:1 1 260px;max-width:360px}
.sp .pbar{height:6px;background:var(--fill3);border-radius:3px;overflow:hidden}
.sp .pbar i{display:block;height:100%;background:var(--tint);border-radius:3px;transition:width .9s linear}
.sp .pbar.ind i{width:30%;animation:sp-ind 1.4s ease-in-out infinite}
@keyframes sp-ind{from{transform:translateX(-100%)}to{transform:translateX(340%)}}
.sp .stat{font-size:14px;color:var(--label2);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0}
.sp .stat b{color:var(--label);font-weight:600}
.sp .err{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--label);margin:0}
.sp .err svg{width:18px;height:18px;flex:none;color:var(--orange);margin-top:1px}
.sp .val{font-variant-numeric:tabular-nums;font-size:17px;font-weight:600;white-space:nowrap}
.sp .val small{font-size:13px;color:var(--label2);font-weight:400}
.sp .val.live{color:var(--tintTx)}
.sp .val.none{color:var(--label3);font-weight:400}
.sp .win{display:inline-flex;gap:3px;align-items:center;font-size:12px;font-weight:600;color:var(--green);white-space:nowrap}
.sp .win svg{width:14px;height:14px}
.sp .verdict{font-size:19px;font-weight:700;letter-spacing:-.02em;line-height:1.25;margin:0}
.sp .verdict small{display:block;font-size:14px;font-weight:400;color:var(--label2);letter-spacing:0;margin-top:4px;line-height:1.4}
.sp table.cmp{width:100%;border-collapse:collapse;font-size:15px;margin-top:8px}
.sp .cmp th,.sp .cmp td{padding:10px 12px;text-align:right;font-variant-numeric:tabular-nums;border:0;background:none}
.sp .cmp tbody th{text-align:left;color:var(--label2);font-weight:400}
.sp .cmp thead th{font-size:13px;font-weight:700;color:var(--c);padding-top:4px}
.sp .cmp tbody tr+tr>*{border-top:1px solid var(--sep)}
.sp .cmp .cell{display:inline-flex;flex-direction:column;align-items:flex-end;gap:1px}
.sp .cmp .via{font-size:12px;color:var(--label3);font-weight:400}
.sp .sr{position:absolute;left:-9999px}
.sp .sub2{display:grid;gap:14px}
@container (min-width:700px){.sp .sub2{grid-template-columns:1.15fr 1fr;align-items:start}}
.sp .sub2>*{min-width:0}
.sp .mhead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}
.sp .mhead>span{font-size:12px;color:var(--label3);white-space:nowrap}
.sp .livetag{font-size:11px;font-weight:700;color:var(--tintTx);margin-right:6px;text-transform:uppercase;letter-spacing:.04em}
.sp .car{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;cursor:grab;border-radius:8px}
.sp .car::-webkit-scrollbar{display:none}
.sp .car.drag{scroll-snap-type:none;cursor:grabbing;user-select:none}
.sp .car>.slide{flex:0 0 100%;min-width:0;scroll-snap-align:start}
.sp svg.ch{display:block;width:100%;height:auto}
.sp svg.ch text{font-size:11px;fill:var(--label2);font-family:inherit}
.sp svg.ch text.dl{font-size:12px;font-weight:700}
.sp svg.ch path.ln{fill:none;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.sp svg.ch line.gr{stroke:var(--sep)}
@container (max-width:500px){.sp svg.ch text{font-size:21px}.sp svg.ch text.dl{font-size:22px}}
.sp .list{background:var(--bg2);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}
.sp .hrow{display:flex;gap:12px;align-items:center;padding:10px 14px;min-height:52px;position:relative}
.sp .hrow+.hrow::before{content:"";position:absolute;top:0;left:14px;right:0;border-top:1px solid var(--sep)}
.sp .hrow .when{flex:1;min-width:0;font-size:15px}
.sp .hrow .when span{display:block;font-size:13px;color:var(--label2)}
.sp .hrow .pair{display:flex;gap:14px;font-size:14px;font-variant-numeric:tabular-nums}
.sp .hrow .pair span{display:grid;justify-items:end}
.sp .hrow .pair small{font-size:11px;font-weight:700;color:var(--c)}
.sp .empty{padding:18px 14px;color:var(--label2);font-size:14px}
.sp .toast{position:sticky;bottom:12px;margin:0 auto;width:max-content;max-width:100%;background:var(--label);color:var(--bg2);border-radius:999px;padding:10px 16px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:2}
@media (prefers-reduced-motion:reduce){.sp .pbar i{transition:none}.sp .pbar.ind i{animation:none;width:100%;opacity:.4}}
`;

// minimal DOM diff: same-type nodes are updated in place, others replaced
function morphKids(a, b) {
	const ac = [ ...a.childNodes ], bc = [ ...b.childNodes ];
	bc.forEach((n, k) => {
		const o = ac[k];
		if (!o) a.appendChild(n);
		else if (o.nodeName !== n.nodeName) a.replaceChild(n, o);
		else if (o.nodeType === 3 || o.nodeType === 8) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; }
		else {
			// the chart's "drag" class is set by the pointer code, not by render
			const keep = o.dataset && o.dataset.keep;
			[ ...o.attributes ].forEach(({ name }) => { if (!n.hasAttribute(name) && !(keep && name === 'class')) o.removeAttribute(name); });
			[ ...n.attributes ].forEach(({ name, value }) => { if (o.getAttribute(name) !== value && !(keep && name === 'class')) o.setAttribute(name, value); });
			morphKids(o, n);
		}
	});
	for (let k = bc.length; k < ac.length; k++) a.removeChild(ac[k]);
}

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

return view.extend({
	load() {
		return Promise.all([ callStatus(), callHist() ]);
	},

	render(r) {
		this.st = { which: 'both', slide: 0, toast: '' };
		const root = E('div', { 'class': 'sp' });
		root.innerHTML = `<style>${CSS}</style><div data-r="main"></div>`;
		this.root = root;
		this.main = root.querySelector('[data-r=main]');

		root.addEventListener('click', ev => {
			const t = ev.target.closest('[data-a]');
			if (t && root.contains(t) && !t.hasAttribute('disabled')) this.act(t.dataset.a);
		});
		// a swipe (or trackpad scroll) settles on a chart: remember it, move the segment
		root.addEventListener('scroll', ev => {
			const c = ev.target;
			if (!c.classList || !c.classList.contains('car') || c.classList.contains('drag')) return;
			const k = Math.round(c.scrollLeft / c.clientWidth);
			if (this.st.slide !== k) { this.st.slide = k; this.markSeg(k); }
		}, true);
		// mouse drag swipes too: past 15% of the width goes to the other chart
		root.addEventListener('pointerdown', ev => {
			const c = ev.target.closest('.car');
			if (!c || ev.pointerType !== 'mouse' || ev.button !== 0) return;
			const x0 = ev.clientX, s0 = c.scrollLeft, k0 = Math.round(s0 / c.clientWidth);
			c.setPointerCapture(ev.pointerId); c.classList.add('drag');
			const mv = e => { c.scrollLeft = s0 - (e.clientX - x0); };
			const up = e => {
				c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
				const dx = e.clientX - x0, k = Math.max(0, Math.min(1, Math.abs(dx) > c.clientWidth * .15 ? k0 + (dx < 0 ? 1 : -1) : k0));
				this.goSlide(k);
				setTimeout(() => c.classList.remove('drag'), 450);
			};
			c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
		});
		root.addEventListener('keydown', ev => {
			if (!ev.target.classList.contains('car') || ![ 'ArrowLeft', 'ArrowRight' ].includes(ev.key)) return;
			ev.preventDefault();
			this.goSlide(ev.key === 'ArrowRight' ? 1 : 0);
		});

		this.parseHist(r[1]);
		this.update(r[0], true);
		// every second while a test runs, every 5 s otherwise (a test started from another tab shows up)
		let n = 0;
		poll.add(() => this.busy() || ++n % 5 === 0 ? callStatus().then(s => this.update(s)) : Promise.resolve(), 1);
		return root;
	},

	busy() { return this.S && (this.S.st === 'wait' || this.S.st === 'run'); },

	parseHist(r) {
		this.hist = ((r && r.hist) || '').split('\n').filter(l => l).map(l => {
			const f = l.split(','), p = o => ({ ping: num(f[o]), jit: num(f[o + 1]), down: num(f[o + 2]), up: num(f[o + 3]), mb: num(f[o + 4]) });
			return { ts: +f[0], which: f[1], v4: p(2), v6: p(7), cpu: { down: { max: num(f[12]) }, up: { max: num(f[13]) } } };
		}).reverse();
	},

	update(r, first) {
		const prev = this.S;
		const S = { st: 'idle', res: {}, smp: {}, cpu: {} };
		((r && r.st) || '').split('\n').forEach(l => {
			const k = l.slice(0, 2), x = l.slice(2);
			if (k === 'S ') {
				const f = x.split('|');
				Object.assign(S, { st: f[0] || 'idle', which: f[1], step: f[2], el: +f[3] / 100 || 0, dur: +f[4], msg: f[5], t0: +f[6], clat: f[7] === '1', colo: f[8], uplink: f[9] });
			}
			else if (k === 'R ') {
				const f = x.split(' ');
				S.res[f[0]] = { ping: num(f[1]), jit: num(f[2]), down: num(f[3]), up: num(f[4]), mb: num(f[5]), noroute: f[6] === 'no' };
			}
			else if (k === 'C ') {
				const f = x.split(' ');
				S.cpu[f[0].split('.')[1]] = { avg: num(f[1]), max: num(f[2]) };
			}
			else if (k === 'D ') {
				const sp = x.indexOf(' ');
				S.smp[x.slice(0, sp)] = x.slice(sp + 1).trim().split(' ').filter(s => s).map(s => s.split(':').map(Number));
			}
		});
		this.S = S;
		const [ sp, sph ] = (S.step || '').split('.');
		S.p = sp; S.ph = sph;
		if (!first && prev) {
			const was = prev.st === 'wait' || prev.st === 'run';
			// the chart turns to what is being measured now
			if (S.st === 'run' && S.step !== prev.step && (S.ph === 'down' || S.ph === 'up')) this.st.follow = S.ph === 'up' ? 1 : 0;
			if (was && S.st === 'done') { this.toast('Test done.'); return callHist().then(h => { this.parseHist(h); this.draw(); }); }
			if (was && S.st === 'stopped') this.toast('Test stopped. It was not saved to Recent.');
		}
		else if (first && S.st === 'run' && S.ph) this.st.slide = S.ph === 'up' ? 1 : 0;
		if (S.which && this.busy()) this.st.which = S.which;
		this.draw();
	},

	toast(t) {
		this.st.toast = t;
		clearTimeout(this.tt);
		this.tt = setTimeout(() => { this.st.toast = ''; this.draw(); }, 4000);
	},

	act(a) {
		const [ k, arg ] = a.split(':');
		if (k === 'run' && !this.busy()) {
			this.st.starting = true; this.draw();
			return callStart(this.st.which).then(r => {
				this.st.starting = false;
				if (r.result === 'busy') this.toast('A test is already running.');
				else if (r.result !== 'started') this.toast('The test could not start. Try again.');
				this.st.slide = 0;
				return callStatus().then(s => this.update(s));
			});
		}
		if (k === 'stop' && this.busy()) return callStop().then(() => callStatus()).then(s => this.update(s));
		if (k === 'which' && !this.busy()) { this.st.which = arg; this.draw(); }
		if (k === 'slide') this.goSlide(+arg);
	},

	goSlide(k) {
		this.st.slide = k;
		const c = this.root.querySelector('.car');
		if (c) c.scrollTo({ left: k * c.clientWidth, behavior: reduce.matches ? 'auto' : 'smooth' });
		this.markSeg(k);
	},

	markSeg(k) {
		this.root.querySelectorAll('[data-a^="slide:"]').forEach((b, j) => { b.classList.toggle('on', j === k); b.setAttribute('aria-pressed', j === k); });
		const c = this.root.querySelector('.car');
		if (c) c.setAttribute('aria-label', `${k ? 'Upload' : 'Download'} chart, use left and right arrows to switch`);
	},

	/* ---------- what to show ---------- */

	// results: this boot's last test, else the newest saved one (no charts then)
	results() {
		const S = this.S;
		if (Object.keys(S.res).length || S.st !== 'idle') return S.res;
		const h = this.hist[0];
		return h ? { v4: h.v4.down != null || h.v4.ping != null ? h.v4 : undefined, v6: h.v6.down != null || h.v6.ping != null ? h.v6 : undefined } : {};
	},

	// tayga's CPU during the IPv4 download / upload (busiest second, % of one core), same source as results()
	clatLoad() {
		const S = this.S;
		if (Object.keys(S.res).length || S.st !== 'idle') return S.cpu;
		return this.hist[0] ? this.hist[0].cpu : {};
	},

	// one sentence for under the answer: is CLAT what limits IPv4?
	clatNote() {
		const c = this.clatLoad(), m = Math.max(c.down && c.down.max || 0, c.up && c.up.max || 0);
		if (this.busy() || !(c.down && c.down.max != null)) return '';
		// tayga is single-threaded: one full core is as fast as it gets
		return m >= 90 ? ` CLAT (tayga) was at its limit, ${m}% of one core, so IPv4 can't go faster through it.`
			: m >= 70 ? ` CLAT (tayga) was close to its limit, ${m}% of one core; a faster line would hit it.`
			: ` CLAT (tayga) used at most ${m}% of one core, so it isn't what limits IPv4.`;
	},

	// the value for (protocol, measure): live while it is being measured, then the result
	val(p, k) {
		const S = this.S, res = this.results()[p];
		if (S.st === 'run' && S.p === p && S.ph === k && k !== 'ping') {
			const s = S.smp[`${p}.${k}`];
			if (s && s.length) return { v: s[s.length - 1][1], live: true };
		}
		return res && res[k] != null ? { v: res[k] } : null;
	},

	show(x, k) {
		if (!x) return '<span class="val none">—</span>';
		const u = k === 'ping' || k === 'jit' ? 'ms' : 'Mbps', v = u === 'ms' ? Math.round(x.v) : f1(x.v);
		return `<span class="val${x.live ? ' live' : ''}">${v} <small>${u}</small></span>`;
	},

	better(k) {
		const r = this.results(), a = r.v4 && r.v4[k], b = r.v6 && r.v6[k];
		if (a == null || b == null || this.busy()) return null;
		return k === 'ping' || k === 'jit' ? (a <= b ? 'v4' : 'v6') : (a >= b ? 'v4' : 'v6');
	},

	steps(which) {
		return (which === 'v4' ? [ 'v4' ] : which === 'v6' ? [ 'v6' ] : [ 'v4', 'v6' ]).flatMap(p => [ 'ping', 'down', 'up' ].map(ph => `${p}.${ph}`));
	},

	progress() {
		const S = this.S, st = this.steps(S.which), i = st.indexOf(S.step);
		const tot = st.reduce((s, x) => s + LEN[x.split('.')[1]] + 1, 0);
		const done = (i < 0 ? 0 : st.slice(0, i).reduce((s, x) => s + LEN[x.split('.')[1]] + 1, 0)) + Math.min(S.el, i < 0 ? 0 : LEN[S.ph]);
		return { f: Math.min(1, done / tot), left: Math.max(1, Math.round(tot - done)) };
	},

	// data use from the newest saved test of the same kind, else a guess from the line's usual speed
	estimate() {
		const w = this.st.which, ps = w === 'both' ? [ 'v4', 'v6' ] : [ w ];
		const h = this.hist.find(x => ps.every(p => x[p].mb != null));
		const mb = h ? ps.reduce((s, p) => s + h[p].mb, 0) : ps.length * 250;
		const secs = ps.length * (LEN.ping + LEN.down + LEN.up + 3);
		return `Takes about ${secs} s and uses about ${size(mb)} of mobile data.`;
	},

	verdict() {
		const S = this.S, r = this.results(), r4 = r.v4, r6 = r.v6;
		if (S.st === 'wait') return [ 'Getting ready…', 'The router finishes its own line check first.' ];
		if (S.st === 'run') return [ `Testing ${PR[S.p].name}…`, 'The answer appears when the test is done.' ];
		if (r4 && r4.noroute || r6 && r6.noroute) return [ `${r4 && r4.noroute ? 'IPv4' : 'IPv6'} isn't available on this line right now.`, 'The router has no route for it, so only the other one was measured.' ];
		if (!(r4 && r4.down != null && r6 && r6.down != null)) {
			if (r4 && r4.down != null || r6 && r6.down != null) return [ `Only ${r4 && r4.down != null ? 'IPv4' : 'IPv6'} was tested.`, 'Choose IPv4 + IPv6 to compare them.' ];
			return [ 'Which is faster on your line, IPv4 or IPv6?', 'Run a test to find out. Both are measured one after the other against the same server.' ];
		}
		const w = r6.down >= r4.down ? 'v6' : 'v4', l = w === 'v6' ? 'v4' : 'v6', A = r[w], B = r[l];
		const pct = Math.round((A.down / B.down - 1) * 100), pd = B.ping != null && A.ping != null ? B.ping - A.ping : 0;
		if (pct < 3) return [ 'IPv4 and IPv6 are about as fast.', `${f1(r4.down)} vs ${f1(r6.down)} Mbps download.` ];
		return [ `${PR[w].name} is faster, by ${pct}%.`, `${f1(A.down)} vs ${f1(B.down)} Mbps download${pd > 0 ? `, and ${pd} ms quicker to respond` : pd < 0 ? `, though ${-pd} ms slower to respond` : ''}.` ];
	},

	// throughput over the 10 s of one step, both protocols on the same axes, named at the line ends
	chart(ph) {
		const W = 600, h = 230, L = 36, R = 54, B = 22, T = 10, S = this.S;
		const ser = [ 'v4', 'v6' ].map(p => [ p, S.smp[`${p}.${ph}`] || [] ]);
		const top = nice(Math.max(10, ...ser.flatMap(([ , s ]) => s.map(q => q[1]))) * 1.05);
		const X = f => L + Math.min(1, f) * (W - L - R), Y = v => h - B - v / top * (h - B - T);
		const grid = [ 0, .5, 1 ].map(g => `<line class="gr" x1="${L}" x2="${W - R}" y1="${Y(top * g)}" y2="${Y(top * g)}"/><text x="${L - 6}" y="${Y(top * g) + 4}" text-anchor="end">${top * g % 1 ? (top * g).toFixed(1) : top * g}</text>`).join('');
		const xs = [ 0, .5, 1 ].map(g => `<text x="${X(g)}" y="${h - 6}" text-anchor="${g ? g === 1 ? 'end' : 'middle' : 'start'}">${g * LEN[ph]} s</text>`).join('');
		const lines = ser.map(([ p, s ]) => {
			if (!s.length) return '';
			const pts = [ [ 0, 0 ], ...s ], e = s[s.length - 1];
			return `<path class="ln" stroke="${PR[p].c}" d="${pts.map((q, i) => (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1)).join('')}"/>
				<text class="dl" fill="${PR[p].c}" x="${X(e[0]) + 6}" y="${Y(e[1]) + (p === 'v4' ? 12 : -4)}">${PR[p].name}</text>`;
		}).join('');
		const lab = ser.map(([ p, s ]) => s.length ? `${PR[p].name} ${f1(s[s.length - 1][1])} Mbps` : '').filter(x => x).join(', ');
		return `<svg class="ch" viewBox="0 0 ${W} ${h}" role="img" aria-label="${PH[ph]} over ${LEN[ph]} seconds. ${lab || (Object.keys(S.smp).length ? 'Not measured' : 'Run a test to see it')}">${grid}${xs}${lines}</svg>`;
	},

	/* ---------- page ---------- */

	draw() {
		const S = this.S, st = this.st, busy = this.busy();
		const via = { v4: S.clat ? 'through CLAT' : 'direct', v6: 'direct' };
		const city = S.colo ? CITY[S.colo] || S.colo : 'Mumbai';
		const sub = `Router${S.uplink ? ' → ' + esc(S.uplink) : ''} → Cloudflare, ${esc(city)}`;

		let status;
		if (S.st === 'wait') status = `<div class="pbar ind" role="progressbar" aria-label="Speed test"><i></i></div><p class="stat" aria-live="polite"><span>${esc(S.msg || 'Getting ready')}…</span></p>`;
		else if (S.st === 'run') {
			const pg = this.progress();
			status = `<div class="pbar" role="progressbar" aria-label="Speed test" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pg.f * 100)}"><i style="width:${(pg.f * 100).toFixed(1)}%"></i></div>
				<p class="stat" aria-live="polite"><span><b>${PR[S.p] ? PR[S.p].name : ''}</b> · ${WORDS[S.ph] || ''}</span><span>about ${pg.left} s left</span></p>`;
		}
		else if (S.st === 'error') status = `<p class="err" role="status">${svg('warn')}<span>${esc(S.msg)}</span></p>`;
		else status = `<p class="stat"><span>Tests the router's own internet line, not your Wi-Fi. ${this.estimate()}</span></p>`;

		const seg = `<div class="seg" role="group" aria-label="What to test">${[ [ 'both', 'IPv4 + IPv6' ], [ 'v4', 'IPv4' ], [ 'v6', 'IPv6' ] ].map(([ v, l ]) =>
			`<button data-a="which:${v}" class="${st.which === v ? 'on' : ''}" aria-pressed="${st.which === v}"${busy ? ' disabled' : ''}>${l}</button>`).join('')}</div>`;
		const btn = busy ? '<button class="btns" data-a="stop">Stop</button>'
			: `<button class="btnp" data-a="run"${st.starting ? ' disabled' : ''}>${S.st === 'idle' && !this.hist.length ? 'Run Test' : 'Test Again'}</button>`;

		const r = this.results();
		const cell = (p, k) => {
			const x = r[p];
			if (k === 'mb') return x && x.mb != null && x.up != null ? `<span class="val" style="font-weight:400;font-size:15px">${size(x.mb)}</span>` : '<span class="val none">—</span>';
			if (k === 'jit') return this.show(x && x.jit != null ? { v: x.jit } : null, 'jit');
			if (k === 'clat') {
				if (p === 'v6') return '<span class="val none" style="font-size:14px">not used</span>';
				const c = this.clatLoad(), d = c.down && c.down.max, u = c.up && c.up.max;
				if (d == null) return '<span class="val none">—</span>';
				const m = Math.max(d, u || 0), tag = m >= 90 ? 'At its limit' : m >= 70 ? 'Near its limit' : '';
				return `<span class="val"${tag ? ' style="color:var(--orange)"' : ''}>${d}% <small>of a core</small></span>${u != null ? `<span class="via">upload ${u}%</span>` : ''}${tag ? `<span class="win" style="color:var(--orange)">${svg('warn')}${tag}</span>` : ''}`;
			}
			if (x && x.noroute && k === 'down') return '<span class="val none" style="font-size:14px">No route</span>';
			return this.show(this.val(p, k), k);
		};
		const rows = [ [ 'down', 'Download' ], [ 'up', 'Upload' ], [ 'ping', 'Ping' ], [ 'jit', 'Jitter' ], [ 'mb', 'Data used' ] ];
		// the CLAT row while CLAT runs, or when the shown test measured it
		const cl = this.clatLoad();
		if (S.clat || cl.down && cl.down.max != null) rows.push([ 'clat', 'CLAT load<div class="via" style="text-align:left">tayga, busiest second</div>' ]);
		const v = this.verdict();
		v[1] += this.clatNote();
		const lastNote = !Object.keys(S.res).length && S.st === 'idle' && this.hist.length ? ` Last test: ${when(this.hist[0].ts).d} ${when(this.hist[0].ts).t}.` : '';
		const live = S.st === 'run' && (S.ph === 'down' || S.ph === 'up') ? `<b class="livetag">Live · ${PH[S.ph]}</b>` : '';

		const recent = this.hist.slice(0, 6).map(x => {
			const w = when(x.ts);
			return `<div class="hrow"><span class="when">${w.d}<span>${w.t}</span></span><span class="pair">${[ 'v4', 'v6' ].map(p =>
				`<span style="--c:${PR[p].c}"><small>${PR[p].name}</small>${x[p].down != null ? f1(x[p].down) : '—'}</span>`).join('')}</span></div>`;
		}).join('');

		const t = document.createElement('div');
		t.innerHTML = `<div class="in">
			<h2 class="lt">Speed Test<small>${sub}</small></h2>
			<div class="card ctl"><div class="ctlrow">${seg}${btn}</div>${status}</div>
			<div class="sub2">
				<div class="card"><p class="verdict" aria-live="polite">${esc(v[0])}<small>${esc(v[1] + lastNote)}</small></p>
					<table class="cmp"><thead><tr><th scope="col"><span class="sr">Measure</span></th>${[ 'v4', 'v6' ].map(p => `<th scope="col" style="--c:${PR[p].c}">${PR[p].name}<div class="via">${via[p]}</div></th>`).join('')}</tr></thead>
					<tbody>${rows.map(([ k, n ]) => `<tr><th scope="row">${n}</th>${[ 'v4', 'v6' ].map(p => `<td><span class="cell">${cell(p, k)}${k !== 'mb' && k !== 'clat' && this.better(k) === p ? `<span class="win">${svg('ok')}Better</span>` : ''}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>
				<div class="card">
					<div class="mhead"><div class="seg" style="flex:0 1 240px" role="group" aria-label="Chart">${[ 'down', 'up' ].map((ph, k) => `<button data-a="slide:${k}" class="${st.slide === k ? 'on' : ''}" aria-pressed="${st.slide === k}">${PH[ph]}</button>`).join('')}</div><span>${live}Mbps</span></div>
					<div class="car" data-keep="car" tabindex="0" aria-label="${st.slide ? 'Upload' : 'Download'} chart, use left and right arrows to switch">${[ 'down', 'up' ].map(ph => `<div class="slide">${this.chart(ph)}</div>`).join('')}</div>
				</div>
			</div>
			<div><p class="cap" style="margin-left:16px">Recent · download</p><div class="list">${recent || '<p class="empty">No tests yet.</p>'}</div>
			<p class="foot">Mbps. Measured by the router itself, so Wi-Fi and device speed limits don't affect it. ${S.clat ? 'IPv4 goes through CLAT (the carrier turns it into IPv6 on the way), which can make it a little slower. ' : ''}</p></div>
			${st.toast ? `<div class="toast" role="status">${esc(st.toast)}</div>` : ''}
		</div>`;
		morphKids(this.main, t);
		if (st.follow != null) { const k = st.follow; st.follow = null; this.goSlide(k); }
		else if (!this.placed) {
			// first draw: put the chart on its slide without animation
			const c = this.root.querySelector('.car');
			if (c && c.clientWidth) { c.scrollLeft = st.slide * c.clientWidth; this.placed = true; }
		}
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
