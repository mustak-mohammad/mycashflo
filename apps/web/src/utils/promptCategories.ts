import type { CallType } from '../types'

export type CanonicalPromptCategory =
  | 'COLLECTIONS'
  | 'OVERDUE'
  | 'COURTESY'
  | 'DISPUTE'
  | 'CALLBACK'
  | 'LEGAL'

export type LegacyPromptCategory = 'REMINDER' | 'FINAL_NOTICE' | 'PAYMENT_PLAN' | 'CUSTOM'

export interface PromptCategoryOption {
  id: CanonicalPromptCategory
  label: string
  description: string
}

export const CANONICAL_PROMPT_CATEGORIES: PromptCategoryOption[] = [
  {
    id: 'COLLECTIONS',
    label: 'Collections (10-Stage)',
    description: 'Standard structured accounts receivable follow-up',
  },
  {
    id: 'OVERDUE',
    label: 'Overdue Escalation',
    description: 'Firm recovery outreach for past-due invoices',
  },
  {
    id: 'COURTESY',
    label: 'Friendly Courtesy',
    description: 'Warm pre-due or gentle check-in reminders',
  },
  {
    id: 'DISPUTE',
    label: 'Dispute & Reconciliation',
    description: 'Billing discrepancy and credit-note resolution calls',
  },
  {
    id: 'CALLBACK',
    label: 'Callback & Handoff',
    description: 'Follow-ups on requested callbacks or representative handoff',
  },
  {
    id: 'LEGAL',
    label: 'Final / Legal Notice',
    description: 'Formal final notice scripts for severely aged balances',
  },
]

export const LEGACY_PROMPT_CATEGORY_LABELS: Record<LegacyPromptCategory, string> = {
  REMINDER: 'Gentle Reminder (Legacy)',
  FINAL_NOTICE: 'Final Urgent Notice (Legacy)',
  PAYMENT_PLAN: 'Payment Plan (Legacy)',
  CUSTOM: 'Custom (Legacy)',
}

const CANONICAL_SET = new Set<string>(CANONICAL_PROMPT_CATEGORIES.map((c) => c.id))
const LEGACY_SET = new Set<string>(Object.keys(LEGACY_PROMPT_CATEGORY_LABELS))

export function normalizePromptCategory(category?: string | null): string {
  return (category || '').trim().toUpperCase()
}

export function isCanonicalPromptCategory(category?: string | null): boolean {
  return CANONICAL_SET.has(normalizePromptCategory(category))
}

export function isLegacyPromptCategory(category?: string | null): boolean {
  return LEGACY_SET.has(normalizePromptCategory(category))
}

export function isSupportedPromptCategory(category?: string | null): boolean {
  const normalized = normalizePromptCategory(category)
  return CANONICAL_SET.has(normalized) || LEGACY_SET.has(normalized)
}

export function getPromptCategoryLabel(category?: string | null): string {
  const normalized = normalizePromptCategory(category)
  const canonical = CANONICAL_PROMPT_CATEGORIES.find((c) => c.id === normalized)
  if (canonical) return canonical.label
  if (normalized in LEGACY_PROMPT_CATEGORY_LABELS) {
    return LEGACY_PROMPT_CATEGORY_LABELS[normalized as LegacyPromptCategory]
  }
  return category || 'Uncategorized'
}

/**
 * Determines whether a prompt category is safe and compatible with a Chotu Voice call type.
 * Preserves compatibility for legacy prompt categories stored in PostgreSQL while strictly
 * isolating DISPUTE scripts to DISPUTE calls (matching backend VoiceService guards).
 */
export function isPromptCompatibleWithCallType(
  promptCategory: string | undefined | null,
  callType: CallType,
): boolean {
  const cat = normalizePromptCategory(promptCategory)
  if (callType === 'DISPUTE') {
    return cat === 'DISPUTE'
  }
  if (callType === 'COLLECTIONS') {
    return (
      cat === 'COLLECTIONS' ||
      cat === 'OVERDUE' ||
      cat === 'COURTESY' ||
      cat === 'LEGAL' ||
      cat === 'REMINDER' ||
      cat === 'FINAL_NOTICE' ||
      cat === 'PAYMENT_PLAN' ||
      cat === 'CUSTOM'
    )
  }
  if (callType === 'CALLBACK') {
    return (
      cat === 'CALLBACK' ||
      cat === 'COURTESY' ||
      cat === 'COLLECTIONS' ||
      cat === 'REMINDER' ||
      cat === 'CUSTOM'
    )
  }
  return false
}

