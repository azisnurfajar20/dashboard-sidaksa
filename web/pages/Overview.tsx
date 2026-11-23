import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleAlert } from 'lucide-react';
import type { ChartItem, Metric, OverviewResponse } from '../../shared/contracts';
import { apiPath, buildQuery, type ViewQuery } from '../lib/query';
import { number } from '../lib/format';
import { MetaLine } from '../components/ui';
const scopeLabels = { 'all-time': 'Seluruh master', 'apply-cohort': 'Cohort tanggal apply', reference: 'Tab referensi' };
export function metricHref(metric: Metric, filters: ViewQuery): string {
  if (metric.scope === 'all-time') return apiPath('/kandidat', { snapshotId: filters.snapshotId });
  if (metric.scope === 'reference') return apiPath('/keberangkatan', { snapshotId: filters.snapshotId });
  const query = buildQuery({ ...filters, ...metric.filter }); return `/rekrutmen${query ? `?${query}` : ''}`;
}
export function categoryHref(kind: string, label: string, filters: ViewQuery): string | null {
  const query: ViewQuery = { ...filters };
  if (kind === 'monthly') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(label)) return null;
    const [year, month] = label.split('-').map(Number); const start = `${label}-01`; const end = `${label}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
    query.from = filters.from && filters.from > start ? filters.from : start; query.to = filters.to && filters.to < end ? filters.to : end;
    if (query.from > query.to) return null;
  } else if (kind === 'status') query.status = label === 'Belum diisi' ? '__empty__' : label;
  else if (kind === 'result') query.finalResult = label === 'Belum diisi' ? '__empty__' : label;
  else if (kind === 'base') query.workBase = label === 'Belum diisi' ? '__empty__' : label;
  else if (kind === 'agent') { if (label === 'Tidak terpetakan') return null; query.agent = label === 'Belum diisi' ? '__empty__' : label; }
  return `/rekrutmen?${buildQuery(query)}`;
}
function Chart({ title, subtitle, items, kind, filters }: { title: string; subtitle: string; items: ChartItem[]; kind: string; filters: ViewQuery }) {
  const maximum = Math.max(...items.map(item => item.value), 1);
  return <section className={`chart-panel chart-${kind}`} aria-label={title}><div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="unit-label">LAMARAN</span></div>{items.length ? <ol className="bar-chart">{items.map((item, index) => { const href = categoryHref(kind, item.label, filters); const content = <><span className="bar-label" title={item.label}>{item.label || 'Belum diisi'}</span><span className="bar-track" aria-hidden="true"><span className={`bar-fill ${kind === 'result' ? 'bar-orange' : ''}`} style={{ width: `${item.value / maximum * 100}%` }}/></span><span className="bar-value">{number(item.value)}</span></>; return <li key={`${item.label}:${index}`}>{href ? <Link to={href} aria-label={`${item.label}: ${number(item.value)} lamaran. Buka rincian.`}>{content}</Link> : <div className="bar-static" title="Rincian kelompok belum tersedia" aria-label={`${item.label}: ${number(item.value)} lamaran. Rincian kelompok belum tersedia.`}>{content}<small>Rincian kelompok belum tersedia</small></div>}</li>; })}</ol> : <div className="chart-empty">Tidak ada data untuk filter ini.</div>}</section>;
}
export function OverviewView({ data }: { data: OverviewResponse }) {
  const filters: ViewQuery = { ...data.meta.filters, snapshotId: data.meta.snapshotId };
  return <><div className="metric-grid" data-testid="overview-metrics">{data.metrics.map(metric => <Link className={`metric-card ${metric.value === null ? 'metric-unavailable' : ''}`} key={metric.key} to={metricHref(metric, filters)} data-testid={`metric-${metric.key}`} aria-label={`${metric.label}: ${metric.value == null ? 'belum tersedia' : number(metric.value)} ${metric.unit}. ${metric.definition}`}><div className="metric-label">{metric.label}<ArrowUpRight size={16} aria-hidden="true"/></div><div className="metric-value">{number(metric.value)}<span>{metric.unit}</span></div><span className="metric-scope">{metric.value == null ? 'Belum tersedia · ' : ''}{scopeLabels[metric.scope]}</span><p>{metric.definition}</p></Link>)}</div>
    <div className="overview-quality"><div><CircleAlert size={18} aria-hidden="true"/><span><strong>{number(data.quality.issueCount)} masalah data</strong> · {number(data.quality.criticalCount)} kritis · {number(data.quality.affectedApplications)} lamaran terdampak</span></div><Link to={apiPath('/kualitas-data', { snapshotId: data.meta.snapshotId })}>Tinjau kualitas data <ArrowUpRight size={15} aria-hidden="true"/></Link></div>
    <div className="charts-grid"><Chart title="Lamaran per bulan apply" subtitle="Cohort tanggal apply, bukan aktivitas bulanan." items={data.charts.monthlyApplications} kind="monthly" filters={filters}/><Chart title="Status proses" subtitle="Status kosong terpisah dari In Progress." items={data.charts.statuses} kind="status" filters={filters}/><Chart title="Hasil seleksi akhir" subtitle="Lolos tidak berarti sudah bekerja atau berangkat." items={data.charts.results} kind="result" filters={filters}/><Chart title="Komposisi basis kerja" subtitle="Volume lamaran pada cohort yang sama." items={data.charts.workBases} kind="base" filters={filters}/><Chart title="Mitra menurut volume lamaran" subtitle="Bukan peringkat agen terbaik; hasil kosong tetap diperhitungkan." items={data.charts.topAgents} kind="agent" filters={filters}/></div><MetaLine meta={data.meta}/></>;
}
