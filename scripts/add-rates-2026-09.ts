/**
 * Rates read from lenders' own published pages on 22 September 2026.
 *
 *   npm run db:rates:sep26          (local)
 *   npm run db:rates:sep26:prod     (Turso)
 *
 * Every figure below was fetched from the URL recorded against it and is
 * reproduced exactly as that page stated it. Nothing is estimated, averaged or
 * carried over from another source. Where a page published a floor ("7.25%
 * onwards") the maximum is left null rather than invented, and where it
 * published a band both ends are recorded.
 *
 * Re-running is safe: the upsert is keyed on (bank, loan type), so a second run
 * refreshes the same rows rather than duplicating them.
 *
 * A note on why this batch is small. India's banks are migrating to the
 * RBI-mandated .bank.in domains, and most deep links to rate pages are
 * currently 301ing to a domain root, a sitemap or a 404 — Bank of Baroda,
 * Punjab National Bank, Canara, Kotak and Axis all failed that way on this
 * pass, and LIC Housing publishes its range only inside an image-based PDF.
 * Those are left alone rather than filled from an aggregator, because the
 * standard this table holds itself to is the lender's own page.
 */
import { all, db, one, run } from "../lib/db";

interface SourcedRate {
  bankSlug: string;
  loanType: string;
  minRate: number;
  /** Null where the lender published a floor rather than a band. */
  maxRate: number | null;
  sourceUrl: string;
  /** The date the lender's page states, or the date it was read. */
  effectiveDate: string;
  notes: string;
}

const READ_ON = "2026-09-22";

const RATES: SourcedRate[] = [
  {
    bankSlug: "state-bank-of-india",
    loanType: "home",
    minRate: 7.25,
    maxRate: null,
    sourceUrl: "https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates",
    effectiveDate: "2026-04-01",
    notes: "Published as \"7.25% p.a. onwards\", effective w.e.f. 01.04.2026. No upper bound stated.",
  },
  {
    bankSlug: "state-bank-of-india",
    loanType: "car",
    minRate: 8.3,
    maxRate: null,
    sourceUrl: "https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates",
    effectiveDate: READ_ON,
    notes: "Published as \"8.30% p.a.\" for auto loans, marked T&C apply. No upper bound or date stated on the page.",
  },
  {
    bankSlug: "icici-bank",
    loanType: "home",
    minRate: 8.5,
    maxRate: 9.8,
    sourceUrl: "https://www.icici.bank.in/personal-banking/loans/home-loan/interest-rates",
    effectiveDate: READ_ON,
    notes:
      "Floating range across all slabs: 8.50% at the bottom, 9.80% at the top (self-employed, above Rs 75 lakh). Page states the rates are valid until 30 September 2026.",
  },
  {
    bankSlug: "union-bank-of-india",
    loanType: "home",
    minRate: 7.15,
    maxRate: null,
    sourceUrl: "https://www.unionbankofindia.bank.in/english/interest-rate-loan.aspx",
    effectiveDate: READ_ON,
    notes: "Published as \"from 7.15%\", conditions apply. No date stated on the page.",
  },
  {
    bankSlug: "union-bank-of-india",
    loanType: "car",
    minRate: 7.5,
    maxRate: null,
    sourceUrl: "https://www.unionbankofindia.bank.in/english/interest-rate-loan.aspx",
    effectiveDate: READ_ON,
    notes: "Published as \"from 7.50%\" for vehicle loans, conditions apply.",
  },
  {
    bankSlug: "union-bank-of-india",
    loanType: "personal",
    minRate: 8.75,
    maxRate: null,
    sourceUrl: "https://www.unionbankofindia.bank.in/english/interest-rate-loan.aspx",
    effectiveDate: READ_ON,
    notes: "Published as \"from 8.75%\", conditions apply.",
  },
];

async function main() {
  await db();
  console.log(`\nApplying ${RATES.length} sourced rate(s)\n`);

  let written = 0;
  for (const r of RATES) {
    const bank = await one<{ id: number; name: string }>(
      `SELECT id, name FROM banks WHERE country = 'in' AND slug = ?`,
      [r.bankSlug],
    );
    if (!bank) {
      console.log(`  SKIP  ${r.bankSlug} — no such lender`);
      continue;
    }

    await run(
      `INSERT INTO rates
         (bank_id, country, loan_type, min_rate, max_rate, source_url, effective_date,
          verified, notes, updated_at)
       VALUES (?, 'in', ?, ?, ?, ?, ?, 1, ?, datetime('now'))
       ON CONFLICT (bank_id, loan_type) DO UPDATE SET
         min_rate       = excluded.min_rate,
         max_rate       = excluded.max_rate,
         source_url     = excluded.source_url,
         effective_date = excluded.effective_date,
         verified       = excluded.verified,
         notes          = excluded.notes,
         updated_at     = datetime('now')`,
      [bank.id, r.loanType, r.minRate, r.maxRate, r.sourceUrl, r.effectiveDate, r.notes],
    );

    const band = r.maxRate === null ? `${r.minRate}%+` : `${r.minRate}–${r.maxRate}%`;
    console.log(`  OK    ${bank.name.padEnd(24)} ${r.loanType.padEnd(9)} ${band}`);
    written++;
  }

  const total = await all<{ loan_type: string; n: number }>(
    `SELECT loan_type, COUNT(*) AS n FROM rates
      WHERE country = 'in' AND verified = 1 AND min_rate IS NOT NULL
      GROUP BY loan_type ORDER BY n DESC`,
  );
  console.log(`\n${written} written. Published rates now:`);
  for (const t of total) console.log(`  ${t.loan_type.padEnd(10)} ${t.n}`);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
