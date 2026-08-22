/**
 * Live smoke check against real, credential-free job boards.
 *
 * Not part of the test suite: it depends on the network and on third parties'
 * boards still existing, so it would make CI flaky. Run it by hand to confirm
 * the adapters work against the real APIs rather than only against fixtures.
 *
 *   pnpm --filter @jobpilot/job-sources exec tsx live-check.ts
 */
import { createDefaultAdapters, searchAllSources } from './src/index';

async function main(): Promise<void> {
  const outcome = await searchAllSources(createDefaultAdapters(), {
    query: { keywords: 'engineer', limit: 25 },
    config: {
      GREENHOUSE_BOARD_TOKENS: 'stripe,figma',
      LEVER_COMPANY_SLUGS: 'netflix',
    },
    logger: {
      debug: () => {},
      warn: (message, meta) => console.warn('  warn:', message, meta ?? ''),
      error: (message) => console.error('  error:', message),
    },
    userAgent: 'JobPilot/0.1 (+https://github.com/usamanadeem786/JobPilot)',
    requestsPerMinute: 30,
    onProgress: (event) => console.log('  progress:', JSON.stringify(event)),
  });

  console.log('\nsearched:', outcome.sourcesSearched);
  console.log('skipped :', outcome.sourcesSkipped.map((entry) => entry.sourceKey));
  console.log('failed  :', outcome.sourcesFailed);
  console.log('unique  :', outcome.jobs.length, '| duplicates removed:', outcome.dedupe.duplicatesRemoved);

  const withDates = outcome.jobs.filter((job) => job.postedAtKnown).length;
  console.log('with a real posting date:', withDates, 'of', outcome.jobs.length);

  console.log('\nfirst three:');
  for (const job of outcome.jobs.slice(0, 3)) {
    console.log(
      JSON.stringify(
        {
          source: job.sourceKey,
          title: job.title,
          company: job.companyName,
          location: job.location,
          remote: job.remoteType,
          level: job.experienceLevel,
          postedAtKnown: job.postedAtKnown,
          descriptionChars: job.description.length,
          applyMethod: job.applyMethod,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
