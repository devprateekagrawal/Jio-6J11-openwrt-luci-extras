'use strict';
'require view';
'require rpc';
'require poll';

// Health: RAM, CPU per core, CLAT load, temperature, storage and service watchdog
// (sampler /usr/bin/health.sh, cron every minute; this page only reads its files).
// Look: an iOS-style grouped inset list that follows LuCI's dark mode.

const callGet = rpc.declare({ object: 'health', method: 'get' });

// the first columns of a sample; then one per CPU core (c0, c1, ...)
const COLS = [ 'ts', 'mem', 'tayga', 'load', 'tcpu', 'tmax', 'tmp', 'ov', 'ndown' ];

const CORE_C = [ 'var(--vblue)', 'var(--vgreen)', 'var(--vorange)', 'var(--vindigo)', 'var(--vteal)', 'var(--vpink)', 'var(--vred)', 'var(--vgray)' ];
// the CPU chart gets one line per core, and tayga's if it runs (set in html())
const CHARTS = {
	ram: { title: 'RAM free (MB)', unit: 'MB', series: [ { key: 'memMB', label: 'Available', color: 'var(--vgreen)', area: true } ] },
	cpu: { title: 'CPU per core (%)', unit: '%', fixed: [ 0, 100 ], series: [] },
	temp: { title: 'Temperature (°C)', unit: '°C', series: [ { key: 'tcpu', label: 'CPU (hottest core)', color: 'var(--vorange)' }, { key: 'tmax', label: 'Hottest sensor', color: 'var(--vred)' } ] },
	load: { title: 'Load average (1 min)', unit: '', series: [ { key: 'load', label: 'Load', color: 'var(--vteal)', area: true } ] }
};

const ICON = {
	ok: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="var(--bg2)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	bad: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="var(--bg2)" stroke-width="1.8" stroke-linecap="round"/></svg>',
	warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l7 12.5H1z" fill="currentColor"/><path d="M8 6v3.6M8 11.6v.1" stroke="var(--bg2)" stroke-width="1.8" stroke-linecap="round"/></svg>',
	off: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
	mem: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 10v4M11 10v4M15 10v4M6 17v3M10 17v3M14 17v3M18 17v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
	cpu: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
	clat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	temp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a2 2 0 014 0v9.5a4.5 4.5 0 11-4 0z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17" r="2" fill="currentColor"/><path d="M12 9v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
	clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
	load: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5-6 4 3 5-7 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	disk: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="12" r="1.4" fill="currentColor"/><path d="M6 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
	ram2: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 7V4M12 7V4M16 7V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
	pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const CSS = `
.hl{
 --bg:#F2F2F7;--bg2:#FFFFFF;--label:#000;--label2:#6C6C70;--label3:#8E8E93;--sep:rgba(60,60,67,.22);
 --fill:rgba(120,120,128,.2);--fill3:rgba(118,118,128,.12);--segon:#FFFFFF;--tint:#007AFF;--tintTx:#0040DD;
 --red:#D70015;--green:#248A3D;--orange:#C93400;--gray:#6C6C70;--purple:#8944AB;
 --vgreen:#34C759;--vred:#FF3B30;--vorange:#FF9500;--vblue:#007AFF;--vpurple:#AF52DE;--vteal:#30B0C7;--vindigo:#5856D6;--vpink:#FF2D55;--vgray:#8E8E93;
 background:var(--bg);color:var(--label);border-radius:18px;padding:4px 0 40px;margin:8px auto 24px;max-width:960px;
 font:15px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;text-align:left;container-type:inline-size
}
:root[data-darkmode="true"] .hl{
 --bg:#000;--bg2:#1C1C1E;--label:#FFF;--label2:#AEAEB2;--label3:#8E8E93;--sep:rgba(84,84,88,.6);
 --fill:rgba(120,120,128,.36);--fill3:rgba(118,118,128,.24);--segon:#636366;--tint:#0A84FF;--tintTx:#409CFF;
 --red:#FF453A;--green:#30D158;--orange:#FF9F0A;--gray:#98989D;--purple:#BF5AF2;
 --vgreen:#30D158;--vred:#FF453A;--vorange:#FF9F0A;--vblue:#0A84FF;--vpurple:#BF5AF2;--vteal:#40C8E0;--vindigo:#5E5CE6;--vpink:#FF375F;--vgray:#8E8E93
}
.hl *{box-sizing:border-box}
.hl button{all:unset;box-sizing:border-box;cursor:pointer}
.hl a{color:var(--tintTx);font-weight:500}
.hl :focus-visible{outline:3px solid color-mix(in srgb,var(--tint) 55%,transparent);outline-offset:2px}
.hl .num{font-variant-numeric:tabular-nums}
.hl .in{max-width:760px;margin:0 auto;padding:0 16px}
.hl h2.lt{font-size:34px;font-weight:700;letter-spacing:-.025em;margin:18px 4px 4px;color:var(--label);border:0;padding:0;background:none;line-height:1.1}
.hl .intro{font-size:13px;color:var(--label2);line-height:1.45;margin:0 4px 6px}
.hl .gh{font-size:13px;color:var(--label2);text-transform:uppercase;letter-spacing:.02em;margin:24px 16px 7px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hl .gh .pill,.hl .gh .refresh{text-transform:none;letter-spacing:0}
.hl .grp{background:var(--bg2);border-radius:12px;overflow:hidden}
.hl .row{display:flex;gap:12px;align-items:center;padding:10px 16px;min-height:48px;position:relative}
.hl .row+.row::before{content:"";position:absolute;top:0;right:0;left:60px;border-top:1px solid var(--sep)}
.hl .row.noi::before{left:16px}
.hl .ic{width:30px;height:30px;border-radius:7px;display:grid;place-items:center;color:#fff;flex:none}
.hl .ic svg{width:18px;height:18px}
.hl .ic.st svg{width:26px;height:26px}
.hl .rt{flex:1;min-width:0}
.hl .rt .t{font-size:17px}
.hl .rt .s{font-size:13px;color:var(--label2);margin-top:1px}
.hl .rv{font-size:17px;color:var(--label2);text-align:right;white-space:nowrap}
.hl .meter{height:6px;border-radius:3px;background:var(--fill);overflow:hidden;margin-top:6px}
.hl .meter i{display:block;height:100%;border-radius:3px;background:var(--vgreen)}
.hl .meter.warn i{background:var(--vorange)}.hl .meter.bad i{background:var(--vred)}
.hl .cores{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-top:6px}
.hl .cores div{font-size:12px;color:var(--label2)}
.hl .cores b{display:block;font-size:15px;color:var(--label);font-weight:500}
.hl .cores .clat b::after{content:" · CLAT";font-size:11px;color:var(--purple);font-weight:600}
.hl .gf{font-size:13px;color:var(--label2);margin:7px 16px 0;line-height:1.45}
.hl .svc .rv{font-size:15px}
.hl .svc .meta{font-size:13px;color:var(--label2);margin-top:3px;display:flex;flex-wrap:wrap;gap:2px 12px}
.hl .chartrow{padding:14px 16px}
.hl .chartrow+.chartrow{border-top:1px solid var(--sep)}
.hl .ok{color:var(--green)}.hl .warn{color:var(--orange)}.hl .bad{color:var(--red)}.hl .off{color:var(--gray)}
.hl .pill{display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 7px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}
.hl .pill.ok{background:color-mix(in srgb,var(--vgreen) 16%,transparent)}
.hl .pill.warn{background:color-mix(in srgb,var(--vorange) 16%,transparent)}
.hl .pill.bad{background:color-mix(in srgb,var(--vred) 15%,transparent)}
.hl .pill.off{background:var(--fill3)}
.hl .pill svg{width:13px;height:13px;flex:none}
.hl .empty{color:var(--label2);font-size:15px;margin:6px 0}
.hl .stale{color:var(--red);font-weight:600}
.hl .refresh{font-size:12px;color:var(--label2);display:inline-flex;gap:5px;align-items:center;margin-left:auto}
.hl .refresh i{width:7px;height:7px;border-radius:50%;background:var(--vgreen)}
.hl .sens{font-size:13px;margin-top:4px}
.hl .sens summary{cursor:pointer;color:var(--tintTx);font-weight:500}
.hl .sens .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:2px 14px;margin-top:6px}
.hl .sens .grid span{display:flex;justify-content:space-between;color:var(--label2)}
.hl .sens .grid b{color:var(--label);font-weight:500}
.hl .seg{display:flex;background:var(--fill3);border-radius:9px;padding:2px;gap:2px}
.hl .seg button{display:block;flex:1;text-align:center;font-size:13px;font-weight:500;padding:6px 10px;border-radius:7px;white-space:nowrap;min-height:30px;color:var(--label)}
.hl .seg button.on{background:var(--segon);box-shadow:0 3px 8px rgba(0,0,0,.12),0 3px 1px rgba(0,0,0,.04);font-weight:600}
.hl .ch .chT{margin:0;font-size:15px;font-weight:600;color:var(--label);background:none;border:0;padding:0}
.hl .ch .lg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--label2);margin:2px 0 6px}
.hl .ch .lg span{display:inline-flex;align-items:center;gap:5px}
.hl .ch .lg i{width:10px;height:3px;border-radius:2px}
.hl .ch .lg i.dash{background:repeating-linear-gradient(90deg,currentColor 0 4px,transparent 4px 7px)!important}
.hl .ch .cv svg{display:block;overflow:visible}
.hl .ch .cv text{font-size:11px;fill:var(--label2);font-variant-numeric:tabular-nums}
.hl .ch .cv .gl{stroke:var(--sep);stroke-width:1}
.hl .ch .cv .cur{stroke:var(--label3);stroke-width:1}
.hl .ch .rd{font-size:12px;color:var(--label2);min-height:1.4em;margin-top:4px;font-variant-numeric:tabular-nums}
.hl .scrollx{overflow-x:auto}
.hl table.dt{width:100%;border-collapse:collapse;font-size:15px;margin:0}
.hl .dt th{font-size:12px;font-weight:500;color:var(--label2);text-align:right;padding:10px 10px 6px;white-space:nowrap;background:none;border:0}
.hl .dt td{text-align:right;padding:9px 10px;border:0;border-top:1px solid var(--sep);white-space:nowrap;background:none;color:var(--label)}
.hl .dt th:first-child,.hl .dt td:first-child{text-align:left;padding-left:16px}
@container (max-width:520px){.hl .cores{grid-template-columns:repeat(2,1fr)}.hl h2.lt{font-size:30px}}
`;

function parse(csv) {
	return (csv || '').split('\n').filter(l => l).map(l => {
		const f = l.split(','), r = {};
		COLS.forEach((c, i) => r[c] = f[i] === '' || f[i] == null ? null : +f[i]);
		for (let k = 0; k < f.length - COLS.length; k++) r['c' + k] = f[COLS.length + k] === '' ? null : +f[COLS.length + k];
		r.memMB = r.mem == null ? null : Math.round(r.mem / 1024);
		return r;
	});
}

function kv(text) {
	const o = {};
	(text || '').split('\n').forEach(l => { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); });
	return o;
}

const p2 = n => String(n).padStart(2, '0');
function fmtWhen(ts, long) {
	const d = new Date(ts * 1000), t = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
	return long ? `${d.getDate()}/${d.getMonth() + 1} ${t}` : t;
}

function dur(s) {
	s = Math.max(0, Math.round(s));
	if (s < 60) return `${s} s`;
	if (s < 3600) return `${Math.floor(s / 60)} min`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min`;
	return `${Math.floor(s / 86400)} d ${Math.floor(s % 86400 / 3600)} h`;
}

const mb = kb => kb >= 1048576 ? `${(kb / 1048576).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`;
const lvl = (v, warn, bad) => v >= bad ? 'bad' : v >= warn ? 'warn' : '';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const meter = (pct, l) => `<div class="meter ${l}"><i style="width:${Math.min(100, Math.max(1, pct)).toFixed(1)}%"></i></div>`;

// status of a state line name|state|since|bad|detail: [class, label]
function status(s) {
	if (s[1] === 'up') return +s[3] ? [ 'warn', 'Check…' ] : [ 'ok', 'Running' ];
	return s[1] === 'down' ? [ 'bad', 'Stopped' ] : [ 'off', 'Off' ];
}
const pill = ([ c, t ]) => `<span class="pill ${c}">${ICON[c]}${t}</span>`;

function readout(c, r, isLast) {
	return `${isLast ? 'Now' : fmtWhen(r.ts, true)} · ` + c.series.map(s => `${s.label}: ${r[s.key] ?? '–'}${c.unit ? ' ' + c.unit : ''}`).join(' · ');
}

return view.extend({
	hours: 6,

	load() {
		return callGet();
	},

	// placeholder for one chart; drawn by paint() once its width is known
	chart(m, key) {
		const c = m.charts[key], x0 = m.now - this.hours * 3600, rows = m.rows.filter(r => r.ts >= x0);
		const title = `<h4 class="chT">${c.title}</h4>`;
		if (!rows.some(r => c.series.some(s => r[s.key] != null)))
			return `<div class="ch">${title}<p class="empty">No data yet. A new point arrives every minute.</p></div>`;
		const id = this.charts.push({ c, rows, x0, now: m.now }) - 1, def = esc(readout(c, rows[rows.length - 1], true));
		return `<div class="ch">${title}
			<div class="lg">${c.series.map(s => `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color};color:${s.color}"></i>${s.label}</span>`).join('')}</div>
			<div class="cv" data-c="${id}" style="height:170px"></div>
			<div class="rd" data-def="${def}">${def}</div></div>`;
	},

	paint() {
		this.root.querySelectorAll('.cv[data-c]').forEach(el => {
			const { c, rows, x0, now } = this.charts[+el.dataset.c];
			const W = Math.max(200, el.clientWidth), Hh = 170, L = 36, R = 8, T = 8, B = 20, vals = [];
			c.series.forEach(s => rows.forEach(r => r[s.key] != null && vals.push(r[s.key])));
			let lo, hi;
			if (c.fixed) { lo = c.fixed[0]; hi = Math.max(c.fixed[1], ...vals); }
			else {
				lo = Math.min(...vals); hi = Math.max(...vals);
				if (hi === lo) hi = lo + 1;
				const pad = (hi - lo) * 0.12;
				lo = Math.min(...vals) >= 0 ? Math.max(0, lo - pad) : lo - pad; hi += pad;
			}
			const X = ts => L + (ts - x0) / (now - x0) * (W - L - R), Y = v => T + (hi - v) / (hi - lo) * (Hh - T - B);
			const parts = [];
			for (let i = 0; i <= 4; i++) {
				const v = lo + (hi - lo) * i / 4, y = Y(v);
				parts.push(`<line class="gl" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${hi - lo < 4 ? v.toFixed(1) : Math.round(v)}</text>`);
			}
			const nt = W < 420 ? 3 : 6;
			for (let i = 0; i <= nt; i++) {
				const ts = x0 + (now - x0) * i / nt;
				parts.push(`<text x="${X(ts)}" y="${Hh - 4}" text-anchor="${i === 0 ? 'start' : i === nt ? 'end' : 'middle'}">${fmtWhen(ts)}</text>`);
			}
			c.series.forEach(s => {
				let d = '', prev = null, first = null, lastX = null;
				rows.forEach(r => {
					if (r[s.key] == null) { prev = null; return; }
					const x = X(r.ts).toFixed(1);
					d += `${prev == null || r.ts - prev > 180 ? 'M' : 'L'}${x},${Y(r[s.key]).toFixed(1)}`;
					if (first == null) first = x;
					lastX = x; prev = r.ts;
				});
				if (s.area && first != null)
					parts.push(`<path d="${d}L${lastX},${Hh - B}L${first},${Hh - B}Z" style="fill:color-mix(in srgb, ${s.color} 14%, transparent)"/>`);
				parts.push(`<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="${s.width || 1.6}" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="5 3"' : ''}/>`);
			});
			el.innerHTML = `<svg width="${W}" height="${Hh}" role="img" aria-label="${esc(c.title + ', ' + readout(c, rows[rows.length - 1], true))}">${parts.join('')}<line class="cur" y1="${T}" y2="${Hh - B}" visibility="hidden"/></svg>`;

			// hover readout of the nearest sample
			const svg = el.firstChild, cur = svg.querySelector('.cur'), rd = el.parentNode.querySelector('.rd');
			const all = rows.filter(r => c.series.some(s => r[s.key] != null));
			svg.addEventListener('mousemove', ev => {
				const b = svg.getBoundingClientRect(), ts = x0 + (ev.clientX - b.left - L) / (W - L - R) * (now - x0);
				const r = all.reduce((a, q) => Math.abs(q.ts - ts) < Math.abs(a.ts - ts) ? q : a, all[0]);
				cur.setAttribute('x1', X(r.ts)); cur.setAttribute('x2', X(r.ts)); cur.setAttribute('visibility', 'visible');
				rd.textContent = readout(c, r, false);
			});
			svg.addEventListener('mouseleave', () => { cur.setAttribute('visibility', 'hidden'); rd.textContent = rd.dataset.def; });
		});
		this.paintedW = this.root.clientWidth;
	},

	html(res) {
		const rows = parse(res.rows), info = kv(res.info), now = res.now, last = rows[rows.length - 1];
		this.charts = [];
		const nc = +info.cores || (last ? Object.keys(last).filter(k => /^c\d+$/.test(k)).length : 0);
		const hasClat = !!info.tayga_pid || rows.some(r => r.tayga != null);
		const cpu = { ...CHARTS.cpu, title: hasClat ? 'CPU per core (%) + CLAT' : 'CPU per core (%)',
			series: [ ...Array(nc).keys() ].map(k => ({ key: 'c' + k, label: 'CPU' + k, color: CORE_C[k % CORE_C.length] }))
				.concat(hasClat ? [ { key: 'tayga', label: 'tayga (CLAT)', color: 'var(--vpurple)', dash: true, width: 2 } ] : []) };
		const m = { rows, now, charts: { ...CHARTS, cpu } };

		// services: state file name|state|since|bad|detail|label|description
		const st = (res.state || '').split('\n').filter(l => l).map(l => l.split('|'));
		const label = {};
		st.forEach(s => label[s[0]] = s[5] || s[0]);
		const svcName = n => label[n] || n;

		const row = (ic, color, t, v, extra, sub) => `<div class="row"><span class="ic" style="background:${color}">${ICON[ic]}</span>
			<div class="rt"><div class="t">${t}</div>${sub ? `<div class="s">${sub}</div>` : ''}${extra || ''}</div>${v ? `<div class="rv num">${v}</div>` : ''}</div>`;

		let abhi;
		if (!info.ts)
			abhi = `<div class="grp"><div class="row noi"><p class="empty">The sampler hasn't written anything yet. Cron runs it every minute, so wait a minute.</p></div></div>`;
		else {
			const age = now - info.ts, tot = +info.memtotal, av = +info.memavail, used = (tot - av) / tot * 100;
			const swapUsed = +info.swaptotal - +info.swapfree;
			const core = info.tayga_core === '' || info.tayga_core == null ? null : +info.tayga_core;
			const temps = (info.temps || '').split(' ').map(t => t.split(':')).filter(t => t.length === 2);
			const tcpu = last ? last.tcpu : null, tmax = last ? last.tmax : null;
			const tLvl = tmax >= 85 ? 'bad' : tmax >= 75 ? 'warn' : '';
			const clatOn = last && last.tayga != null && info.tayga_pid;
			const ov = +info.ovtotal ? +info.ovused / +info.ovtotal * 100 : null, tmp = +info.tmpused / +info.tmptotal * 100;

			abhi = `<div class="grp">
				${row('clock', 'var(--vgray)', 'Uptime', dur(+info.uptime + age), '', `running since ${fmtWhen(now - info.uptime - age, true)}`)}
				${row('mem', 'var(--vgreen)', 'RAM', '', meter(used, av < 51200 ? 'bad' : av < 102400 ? 'warn' : ''),
					`${mb(tot - av)} used / ${mb(tot)} · ${mb(av)} free${swapUsed > 0 ? ` · swap (zram) ${mb(swapUsed)}` : ''}`)}
				${row('cpu', 'var(--vblue)', 'CPU per core', '', `<div class="cores num">${[ ...Array(nc).keys() ].map(k => {
					const v = last ? last['c' + k] : null;
					return `<div class="${k === core ? 'clat' : ''}"><b>${v ?? '–'}%</b>CPU${k}${meter(v ?? 0, lvl(v ?? 0, 70, 90))}</div>`;
				}).join('')}</div>`)}
				${!hasClat ? '' : row('clat', 'var(--vpurple)', 'CLAT (tayga)', clatOn ? `${last.tayga}%` : '', clatOn ? meter(last.tayga, lvl(last.tayga, 70, 90)) : '',
					clatOn ? `${last.tayga}% of one core${core != null ? ` (CPU${core})` : ''} · single-threaded, 100% = the IPv4 limit` : 'Not running (stopped, or the uplink does not need CLAT now)')}
				${row('load', 'var(--vteal)', 'Load', esc((info.load || '').split(' ').join(' / ')), '', `1 / 5 / 15 min · ${nc} core${nc === 1 ? '' : 's'}, ${nc}.0 = all busy`)}
				${!temps.length ? row('temp', 'var(--vorange)', 'Temperature', '–', '', 'No temperature sensors found') : row('temp', 'var(--vorange)', 'Temperature', `<span class="${tLvl}">CPU ${tcpu ?? '–'} °C</span>`,
					`<details class="sens"${this.sensOpen ? ' open' : ''}><summary>All ${temps.length} sensors</summary><div class="grid">${temps.map(t => `<span>${esc(t[0])} <b>${esc(t[1])} °C</b></span>`).join('')}</div></details>`,
					`hottest sensor ${tmax ?? '–'} °C`)}
				${ov == null ? '' : row('disk', 'var(--vindigo)', 'Flash (overlay)', `${mb(+info.ovused)} / ${mb(+info.ovtotal)}`, meter(ov, lvl(ov, 70, 90)))}
				${row('ram2', 'var(--vpink)', '/tmp (RAM)', `${mb(+info.tmpused)} / ${mb(+info.tmptotal)}`, meter(tmp, lvl(tmp, 50, 75)))}
				${row('pulse', 'var(--vgreen)', 'Last sample', '', '', `${fmtWhen(+info.ts, true)} (${dur(age)} ago)${age > 150 ? ' <span class="stale">· the sampler seems to have stopped (cron?)</span>' : ''}`)}
			</div>`;
		}

		// events ts|name|state|detail
		const events = (res.events || '').split('\n').filter(l => l).map(l => l.split('|'));
		const lastDown = {};
		events.forEach(e => { if (e[2] === 'down') lastDown[e[1]] = +e[0]; });
		const down = st.filter(s => s[1] === 'down');
		const summary = !st.length ? '' : down.length
			? `<span class="pill bad">${ICON.bad}${down.length} stopped: ${down.map(s => esc(svcName(s[0]))).join(', ')}</span>`
			: `<span class="pill ok">${ICON.ok}All ${st.filter(s => s[1] === 'up').length} running</span>`;

		const svc = st.length ? `<div class="grp">${st.map(s => {
			const [ name, , since, , det, , desc ] = s, stt = status(s);
			return `<div class="row svc"><span class="ic st ${stt[0]}">${ICON[stt[0]]}</span>
				<div class="rt"><div class="t">${esc(svcName(name))}</div>${desc ? `<div class="s">${esc(desc)}</div>` : ''}
					<div class="meta"><span>Since: ${fmtWhen(+since, true)} (${dur(now - since)})</span>
					<span>Last stopped: ${lastDown[name] ? `${fmtWhen(lastDown[name], true)} (${dur(now - lastDown[name])} ago)` : '–'}</span>
					<span>${det ? esc(det) : '–'}</span></div></div>
				<div class="rv">${pill(stt)}</div></div>`;
		}).join('')}</div>` : `<div class="grp"><div class="row noi"><p class="empty">${info.ts ? 'No services to watch. Add them to /etc/health.services.' : 'No data yet.'}</p></div></div>`;

		const ev = events.length ? `<div class="grp">${events.slice(-30).reverse().map(e => {
			const c = { up: 'ok', down: 'bad' }[e[2]] || 'off';
			return `<div class="row noi"><div class="rt"><div class="t">${esc(svcName(e[1]))}</div><div class="s">${fmtWhen(+e[0], true)}${e[3] ? ' · ' + esc(e[3]) : ''}</div></div>
				<div class="rv">${pill([ c, { up: 'Back up', down: 'Stopped' }[e[2]] || esc(e[2]) ])}</div></div>`;
		}).join('')}</div>` : `<div class="grp"><div class="row noi"><p class="empty">No service has stopped since the Health page was added.</p></div></div>`;

		const daily = (res.daily || '').split('\n').filter(l => l).map(l => l.split(','));
		const dClat = hasClat || daily.some(d => +d[5] > 0), dCols = a => dClat ? a : a.filter((_, i) => i !== 4);
		const dl = daily.length ? `<div class="grp scrollx"><table class="dt num"><thead><tr>${dCols([ 'Day', 'RAM free (lowest)', 'CPU avg', 'Busiest core', 'CLAT max', 'CPU temp max', 'Load max', 'Services stopped' ]).map(t => `<th>${t}</th>`).join('')}</tr></thead>
			<tbody>${daily.reverse().map(d => `<tr>${dCols([ d[0], mb(+d[2]), `${d[3]}%`, `${d[4]}%`, `${d[5]}%`, d[6] === '' ? '–' : `${d[6]} °C`, d[7], d[8] ]).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
			: `<div class="grp"><div class="row noi"><p class="empty">The first day isn't complete yet. A line for each day is added after midnight.</p></div></div>`;

		const range = `<div class="seg" role="group" aria-label="Graph range">${[ [ 1, '1 hour' ], [ 6, '6 hours' ], [ 24, '24 hours' ] ]
			.map(([ v, t ]) => `<button data-range="${v}" class="${v === this.hours ? 'on' : ''}" aria-pressed="${v === this.hours}">${t}</button>`).join('')}</div>`;

		return `<div class="in">
			<h2 class="lt">Health</h2>
			<p class="intro">The router's health: RAM, CPU per core${hasClat ? ', CLAT (tayga) load' : ''}, temperature, flash and /tmp, and whether the services in /etc/health.services are running.
				One sample a minute (cron, /usr/bin/health.sh, ~30 ms); the graphs cover 24 hours and are kept in RAM. A service that stays stopped for 2 minutes is listed under Service events, and so is its return.</p>
			<div class="gh">Now <span class="refresh"><i></i>Refreshes every 30 s</span></div>${abhi}
			<div class="gh">Services ${summary}</div>${svc}
			<p class="gf">Daemons: whether the process is running. Cron jobs: when the job last took its lock file (= when it last ran), which must be within its schedule. "Check…" = missing in one sample; if it is missing in the next one too, it shows Stopped.</p>
			<div class="gh">Graph</div>
			<div class="grp"><div class="chartrow">${range}</div>${[ 'ram', 'cpu', ...(rows.some(r => r.tmax != null) ? [ 'temp' ] : []), 'load' ].map(k => `<div class="chartrow">${this.chart(m, k)}</div>`).join('')}</div>
			<div class="gh">Service events</div>${ev}
			<div class="gh">Daily summary</div>${dl}
			<p class="gf">One line per day (/root/health-daily.csv, kept for 1 year). After a reboot, the part of that day that was in RAM is lost.</p>
		</div>`;
	},

	update(res) {
		this.res = res;
		const d = this.root.querySelector('details.sens');
		if (d) this.sensOpen = d.open;
		this.root.innerHTML = this.html(res);
		if (this.root.isConnected) this.paint();
		else requestAnimationFrame(() => this.paint());
	},

	refresh() {
		return callGet().then(res => this.update(res));
	},

	render(res) {
		this.root = E('div', { 'class': 'hl' });
		this.root.addEventListener('click', ev => {
			const b = ev.target.closest('button[data-range]');
			if (b) { this.hours = +b.dataset.range; this.update(this.res); }
		});
		// redraw the charts when the width changes (window resize, sidebar)
		new ResizeObserver(() => { if (this.charts && Math.abs(this.root.clientWidth - (this.paintedW || 0)) > 4) this.paint(); }).observe(this.root);
		this.update(res);
		poll.add(() => this.refresh(), 30);
		return E('div', { 'class': 'cbi-map' }, [ E('style', {}, CSS), this.root ]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
