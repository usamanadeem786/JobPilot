import { ContactRole, Provenance } from '@jobpilot/shared';
import { describe, expect, it } from 'vitest';
import {
  classifyRole,
  extractContactsFromJobDescription,
  guessEmailFromName,
  isNeverContact,
  NO_CONTACT_MESSAGE,
} from './discover';

const context = { companyName: 'Acme Inc', jobUrl: 'https://boards.example.com/acme/1' };

describe('extractContactsFromJobDescription', () => {
  it('finds a role mailbox the employer published', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'To apply, send your CV to careers@acme.com and we will be in touch.',
    });

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.email).toBe('careers@acme.com');
    expect(result.contacts[0]?.confidence).toBeGreaterThan(0.9);
  });

  it('records provenance as KNOWN, never VERIFIED', () => {
    // VERIFIED is reserved for confirmation against a second permitted source.
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Questions? Email recruiting@acme.com.',
    });
    expect(result.contacts[0]?.provenance).toBe(Provenance.KNOWN);
  });

  it('keeps the evidence, so a user can check the claim themselves', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Reach our talent team at talent@acme.com for anything about this role.',
    });
    expect(result.contacts[0]?.evidence).toContain('talent@acme.com');
    expect(result.contacts[0]?.sourceUrl).toBe(context.jobUrl);
  });

  it('reads a named recruiter when the employer wrote one', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Our technical recruiter Jane Smith is handling this role — reach her at jane@acme.com.',
    });

    expect(result.contacts[0]?.name).toBe('Jane Smith');
    expect(result.contacts[0]?.role).toBe(ContactRole.RECRUITER);
  });

  it('scores a named individual lower than a role mailbox', () => {
    // A role address is unambiguous; a name read out of prose is a weaker
    // reading of the text, and the score should say so.
    const role = extractContactsFromJobDescription({
      ...context,
      description: 'Email careers@acme.com.',
    }).contacts[0];

    const person = extractContactsFromJobDescription({
      ...context,
      description: 'Contact Jane Smith at jane@acme.com.',
    }).contacts[0];

    expect(role?.confidence).toBeGreaterThan(person?.confidence ?? 1);
  });

  it('does not attach a name when the surrounding text has none', () => {
    // A wrong name against an address is worse than no name.
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Send applications to hiring@acme.com.',
    });
    expect(result.contacts[0]?.name).toBeNull();
  });

  it('does not mistake a sentence opener for a person', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'We Are Hiring. Please Contact Us at jobs@acme.com.',
    });
    expect(result.contacts[0]?.name).toBeNull();
  });

  it('returns the exact message the UI shows when nothing is found', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Apply through our careers portal. We look forward to hearing from you.',
    });

    expect(result.contacts).toEqual([]);
    expect(result.message).toBe(NO_CONTACT_MESSAGE);
    expect(NO_CONTACT_MESSAGE).toBe('No verified public contact found.');
  });

  it('ignores addresses that are never a hiring contact', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'noreply@acme.com privacy@acme.com legal@acme.com support@acme.com',
    });
    expect(result.contacts).toEqual([]);
  });

  it('ignores placeholder addresses from template text', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Email us at hr@yourcompany.com or someone@example.com to apply.',
    });
    expect(result.contacts).toEqual([]);
  });

  it('deduplicates a repeated address', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Email careers@acme.com. Again: CAREERS@ACME.COM.',
    });
    expect(result.contacts).toHaveLength(1);
  });

  it('orders the most reliable contact first', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Contact Jane Smith at jane@acme.com, or the team at careers@acme.com.',
    });
    expect(result.contacts[0]?.email).toBe('careers@acme.com');
  });
});

describe('refusing to guess', () => {
  it('has no function that builds an address from a name', () => {
    // The standard technique, and the product refuses it: the result is
    // unverified personal data with no lawful basis, and a wrong guess sends
    // a stranger's inbox a job application.
    expect(() => guessEmailFromName()).toThrow(/never guessed/i);
  });

  it('never invents an address for a named person with no published one', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'This role reports to Jane Smith, our Engineering Manager at Acme Inc.',
    });

    expect(result.contacts).toEqual([]);
    expect(result.message).toBe(NO_CONTACT_MESSAGE);
  });

  it('never produces a firstname.lastname pattern from a name and domain', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description: 'Hiring manager: Jane Smith. Company website: https://acme.com',
    });

    const emails = result.contacts.map((contact) => contact.email);
    expect(emails).not.toContain('jane.smith@acme.com');
    expect(emails).toEqual([]);
  });
});

describe('classifyRole', () => {
  it.each([
    ['our technical recruiter', ContactRole.RECRUITER],
    ['talent acquisition partner', ContactRole.TALENT_ACQUISITION],
    ['the hiring manager for this role', ContactRole.HIRING_MANAGER],
    ['our engineering manager', ContactRole.ENGINEERING_MANAGER],
    ['co-founder and CTO', ContactRole.CTO],
  ])('classifies %j', (text, expected) => {
    expect(classifyRole(text)).toBe(expected);
  });

  it('falls back to OTHER rather than guessing', () => {
    expect(classifyRole('email us about the role')).toBe(ContactRole.OTHER);
  });
});

describe('isNeverContact', () => {
  it.each(['noreply@x.com', 'do-not-reply@x.com', 'legal@x.com', 'press@x.com'])(
    'rejects %s',
    (email) => {
      expect(isNeverContact(email)).toBe(true);
    },
  );

  it('accepts a genuine hiring address', () => {
    expect(isNeverContact('careers@acme.com')).toBe(false);
  });
});

describe('addresses that exist for another purpose', () => {
  it('excludes disability accommodation addresses', () => {
    // Found by running this over real postings: Figma publishes
    // accommodations-ext@figma.com in every job description. It is published,
    // it is on the posting, and a speculative job pitch there would misuse a
    // channel that exists for something else. Published does not mean fair game.
    const result = extractContactsFromJobDescription({
      ...context,
      description:
        'We provide reasonable accommodations. Contact accommodations-ext@acme.com for assistance with your application.',
    });

    expect(result.contacts).toEqual([]);
    expect(result.message).toBe(NO_CONTACT_MESSAGE);
  });

  it.each([
    'accessibility@acme.com',
    'disability-support@acme.com',
    'ethics@acme.com',
    'compliance@acme.com',
  ])('excludes %s', (email) => {
    expect(isNeverContact(email)).toBe(true);
  });

  it('still finds a genuine hiring address in the same description', () => {
    const result = extractContactsFromJobDescription({
      ...context,
      description:
        'Need an accommodation? Email accommodations@acme.com. To apply, write to careers@acme.com.',
    });

    expect(result.contacts.map((contact) => contact.email)).toEqual(['careers@acme.com']);
  });
});
