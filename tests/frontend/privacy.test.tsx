import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CandidateEvidence } from '../../web/pages/Candidates';
import { ApplicationEvidence } from '../../web/pages/Applications';
import { application, candidate, candidateDetail, issue, meta } from './fixture';
describe('sensitive detail projections', () => {
  it('preserves a validated graduation year as a year, not a locale-grouped count', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CandidateEvidence data={candidateDetail}/></MemoryRouter>);
    expect(html).toContain('<dd>2025</dd>'); expect(html).not.toContain('2.025');
  });
  it('never exposes review notes or candidate contacts without the matching permission and verified identity', () => {
    const issues = [{ ...issue, reviewNote: 'REVIEW-PRIVATE' }];
    const candidateHtml = renderToStaticMarkup(<MemoryRouter><CandidateEvidence data={{ ...candidateDetail, issues }} viewContact={false}/></MemoryRouter>);
    expect(candidateHtml).not.toContain('REVIEW-PRIVATE'); expect(candidateHtml).not.toContain(candidate.phone); expect(candidateHtml).not.toContain(candidate.photo);
    const html = renderToStaticMarkup(<MemoryRouter><ApplicationEvidence data={{ row: application, candidate, issues, meta }} viewContact={false}/></MemoryRouter>);
    expect(html).not.toContain('REVIEW-PRIVATE'); expect(html).not.toContain(application.notes); expect(html).not.toContain(candidate.phone);
    const unverified = renderToStaticMarkup(<MemoryRouter><ApplicationEvidence data={{ row: application, candidate, issues, meta }} viewContact/></MemoryRouter>);
    expect(unverified).not.toContain(candidate.phone);
  });
});
