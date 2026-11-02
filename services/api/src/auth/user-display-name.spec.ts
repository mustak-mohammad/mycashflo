import { describe, it, expect } from 'vitest';
import { getDisplayName } from '../../../../apps/web/src/utils/user.js';

describe('User Display Name Logic', () => {
  it('should return saved profile name when present and non-blank', () => {
    expect(getDisplayName({ name: 'Mustak Mohammad', email: 'mustak.mohammad@example.com' })).toBe('Mustak Mohammad');
    expect(getDisplayName({ name: 'Alice Walker', email: 'alice@democorp.in' })).toBe('Alice Walker');
    expect(getDisplayName({ name: '  Bob Marley  ', email: 'bob@democorp.in' })).toBe('Bob Marley');
  });

  it('should derive friendly fallback from email when name is missing or blank', () => {
    // Exact prompt example: mustak.mohammad@example.com -> Mustak Mohammad
    expect(getDisplayName({ name: '', email: 'mustak.mohammad@example.com' })).toBe('Mustak Mohammad');
    expect(getDisplayName({ name: '   ', email: 'mustak.mohammad@example.com' })).toBe('Mustak Mohammad');
    expect(getDisplayName({ name: null, email: 'mustak.mohammad@example.com' })).toBe('Mustak Mohammad');
    expect(getDisplayName({ email: 'mustak.mohammad@example.com' })).toBe('Mustak Mohammad');
  });

  it('should replace dots, underscores, and hyphens with spaces and capitalize words', () => {
    expect(getDisplayName({ email: 'john_doe@example.com' })).toBe('John Doe');
    expect(getDisplayName({ email: 'jane-smith@example.com' })).toBe('Jane Smith');
    expect(getDisplayName({ email: 'rahul.kumar_sharma-singh@example.com' })).toBe('Rahul Kumar Sharma Singh');
    expect(getDisplayName({ email: 'admin@democorp.in' })).toBe('Admin');
  });

  it('should handle edge cases safely', () => {
    expect(getDisplayName(null)).toBe('');
    expect(getDisplayName(undefined)).toBe('');
    expect(getDisplayName({})).toBe('User');
    expect(getDisplayName({ email: '' })).toBe('User');
    expect(getDisplayName({ email: '   ' })).toBe('User');
    expect(getDisplayName({ email: '@example.com' })).toBe('User');
  });
});

