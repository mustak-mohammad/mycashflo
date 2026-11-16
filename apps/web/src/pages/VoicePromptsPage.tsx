import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { promptsApi } from '../api/prompts'
import type { VoicePrompt } from '../types'
import {
  CANONICAL_PROMPT_CATEGORIES,
  LEGACY_PROMPT_CATEGORY_LABELS,
  getPromptCategoryLabel,
  isCanonicalPromptCategory,
  isSupportedPromptCategory,
} from '../utils/promptCategories'

const FILTER_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'ALL', label: 'All Categories' },
  ...CANONICAL_PROMPT_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
  ...(Object.entries(LEGACY_PROMPT_CATEGORY_LABELS).map(([id, label]) => ({
    id,
    label,
  }))),
]

const TEMPLATE_VARIABLES = [
  '{{customerName}}',
  '{{outstandingAmount}}',
  '{{invoiceNumber}}',
  '{{dueDate}}',
  '{{companyName}}',
]

function sanitizeUiErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return fallback
    // Avoid exposing stack traces or HTML error pages
    if (trimmed.includes('\n    at ') || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      return fallback
    }
    return trimmed
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((item) => String(item).trim()).filter(Boolean).join(' • ') || fallback
  }
  return fallback
}

async function extractSafeApiError(err: unknown, fallback: string): Promise<string> {
  const axiosLike = err as {
    response?: { status?: number; data?: unknown }
    message?: string
  }
  const data = axiosLike?.response?.data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const text = await data.text()
      const parsed = JSON.parse(text) as { message?: unknown }
      if (parsed?.message) {
        return sanitizeUiErrorMessage(parsed.message, fallback)
      }
    } catch {
      // Ignore malformed blob error payloads and fall back to status/generic message
    }
  } else if (data && typeof data === 'object' && 'message' in data) {
    return sanitizeUiErrorMessage((data as { message?: unknown }).message, fallback)
  }

  const status = axiosLike?.response?.status
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return 'The requested prompt could not be found.'

  return sanitizeUiErrorMessage(axiosLike?.message, fallback)
}

export default function VoicePromptsPage() {
  const [prompts, setPrompts] = useState<VoicePrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadingZip, setDownloadingZip] = useState(false)

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<VoicePrompt | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Create / Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<VoicePrompt | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('COLLECTIONS')
  const [language, setLanguage] = useState('English')
  const [promptText, setPromptText] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewContent, setPreviewContent] = useState('')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewVariables, setPreviewVariables] = useState<string[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const fetchPrompts = useCallback(
    async (filterCat: string, searchTerm: string) => {
      const data = await promptsApi.list({
        search: searchTerm.trim() || undefined,
        category: filterCat !== 'ALL' ? filterCat : undefined,
      })
      return data
    },
    [],
  )

  const loadPrompts = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchPrompts(categoryFilter, search)
      setPrompts(data)
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, 'Failed to load voice prompts.')
      setLoadError(msg)
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, search, fetchPrompts])

  useEffect(() => {
    let active = true
    void fetchPrompts(categoryFilter, search)
      .then((data) => {
        if (!active) return
        setPrompts(data)
        setLoadError(null)
      })
      .catch(async (err: unknown) => {
        if (!active) return
        const msg = await extractSafeApiError(err, 'Failed to load voice prompts.')
        if (active) setLoadError(msg)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter])

  const handleCategoryChange = (nextCategory: string) => {
    setLoading(true)
    setLoadError(null)
    setCategoryFilter(nextCategory)
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void loadPrompts()
  }

  const handleOpenCreate = () => {
    setEditingPrompt(null)
    setName('')
    setCategory('COLLECTIONS')
    setLanguage('English')
    setPromptText('')
    setIsActive(true)
    setErrorMsg('')
    setIsModalOpen(true)
  }

  const handleOpenEdit = (p: VoicePrompt) => {
    setEditingPrompt(p)
    setName(p.name)
    setCategory(p.category || 'COLLECTIONS')
    setLanguage(p.language)
    setPromptText(p.promptText)
    setIsActive(p.isActive)
    setErrorMsg('')
    setIsModalOpen(true)
  }

  const handleSavePrompt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !promptText.trim()) {
      setErrorMsg('Prompt name and template script are required.')
      return
    }

    const preservingExistingCategory = editingPrompt && editingPrompt.category === category
    if (!isSupportedPromptCategory(category) && !preservingExistingCategory) {
      setErrorMsg(`Unsupported prompt category "${category}". Please select a valid category.`)
      return
    }

    try {
      setSaving(true)
      setErrorMsg('')
      if (editingPrompt) {
        await promptsApi.update(editingPrompt.id, {
          name: name.trim(),
          category,
          language,
          promptText,
          isActive,
        })
        setActionFeedback({ type: 'success', message: `Updated prompt "${name.trim()}".` })
      } else {
        await promptsApi.create({
          name: name.trim(),
          category,
          language,
          promptText,
          isActive,
        })
        setActionFeedback({ type: 'success', message: `Created prompt "${name.trim()}".` })
      }
      setIsModalOpen(false)
      await loadPrompts()
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, 'Failed to save prompt.')
      setErrorMsg(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setActionFeedback(null)
    try {
      await promptsApi.delete(deleteTarget.id)
      setPrompts((prev) => prev.filter((item) => item.id !== deleteTarget.id))
      setActionFeedback({ type: 'success', message: `Deleted prompt "${deleteTarget.name}".` })
      setDeleteTarget(null)
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, 'Failed to delete prompt.')
      setActionFeedback({ type: 'error', message: msg })
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setActionFeedback({
        type: 'error',
        message: 'Unable to copy to clipboard in this browser context.',
      })
    }
  }

  const handlePreview = async (template: string) => {
    try {
      setPreviewLoading(true)
      setPreviewError(null)
      setPreviewModalOpen(true)
      const res = await promptsApi.preview(template)
      setPreviewContent(res.preview)
      setPreviewVariables(res.missingVariables)
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, 'Unable to render speech preview.')
      setPreviewContent('')
      setPreviewVariables([])
      setPreviewError(msg)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleDownloadTxt = async (p: VoicePrompt) => {
    setDownloadingId(p.id)
    setActionFeedback(null)
    try {
      await promptsApi.downloadTxt(p.id, p.name)
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, `Failed to download "${p.name}".`)
      setActionFeedback({ type: 'error', message: msg })
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDownloadZip = async () => {
    setDownloadingZip(true)
    setActionFeedback(null)
    try {
      await promptsApi.downloadZip()
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, 'Failed to download prompts archive.')
      setActionFeedback({ type: 'error', message: msg })
    } finally {
      setDownloadingZip(false)
    }
  }

  const insertVariable = (varName: string) => {
    setPromptText((prev) => prev + (prev.endsWith(' ') || prev.length === 0 ? '' : ' ') + varName)
  }

  const hasLegacyOrCustomCategory =
    Boolean(category) && !isCanonicalPromptCategory(category)

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <PageHeader
          title="Voice Prompts & Templates"
          subtitle="Create, customize, and export structured Chotu AI collection prompts with dynamic accounting variables."
        />
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={downloadingZip}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface-raised, #1e293b)',
              color: 'var(--text-primary, #f8fafc)',
              fontWeight: 600,
              cursor: downloadingZip ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {downloadingZip ? '⏳ Preparing .zip…' : '📦 Download All (.zip)'}
          </button>
          <button
            type="button"
            onClick={handleOpenCreate}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--primary, #3b82f6)',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
            }}
          >
            + Create Prompt
          </button>
        </div>
      </div>

      {/* Inline Action Feedback Banner */}
      {actionFeedback && (
        <div
          role={actionFeedback.type === 'error' ? 'alert' : 'status'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            borderRadius: '10px',
            marginBottom: '16px',
            fontSize: '13px',
            background:
              actionFeedback.type === 'error'
                ? 'rgba(239, 68, 68, 0.14)'
                : 'rgba(16, 185, 129, 0.14)',
            border: `1px solid ${actionFeedback.type === 'error' ? '#ef4444' : '#10b981'}`,
            color: actionFeedback.type === 'error' ? '#fca5a5' : '#6ee7b7',
          }}
        >
          <span>
            {actionFeedback.type === 'error' ? '⚠️ ' : '✓ '}
            {actionFeedback.message}
          </span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setActionFeedback(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--surface-card, #111827)',
          padding: '16px 20px',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          marginBottom: '24px',
        }}
      >
        {/* Category Pills */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {FILTER_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleCategoryChange(c.id)}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                fontSize: '13px',
                fontWeight: 600,
                border: '1px solid',
                borderColor: categoryFilter === c.id ? 'var(--primary, #3b82f6)' : 'var(--border)',
                background: categoryFilter === c.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                color: categoryFilter === c.id ? 'var(--primary, #60a5fa)' : 'var(--text-secondary, #94a3b8)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Search prompt templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface-raised, #1f2937)',
              color: 'var(--text-primary, #f9fafb)',
              fontSize: '13px',
              width: '260px',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface-raised, #374151)',
              color: 'var(--text-primary, #f9fafb)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Search
          </button>
        </form>
      </div>

      {/* Load Error State */}
      {loadError && !loading && (
        <div
          role="alert"
          style={{
            padding: '20px',
            borderRadius: '12px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid #ef4444',
            color: '#fca5a5',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div>
            <strong>Unable to load voice prompts:</strong> {loadError}
          </div>
          <button
            type="button"
            onClick={() => void loadPrompts()}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid #ef4444',
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Prompts Cards Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
          Loading saved voice prompts...
        </div>
      ) : loadError ? null : prompts.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px',
            background: 'var(--surface-card, #111827)',
            borderRadius: '12px',
            border: '1px dashed var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎙️</div>
          <h3 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>No Voice Prompts Found</h3>
          <p style={{ margin: 0, fontSize: '14px' }}>
            Get started by creating a customized collection script or adjusting your category filter.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
            gap: '20px',
          }}
        >
          {prompts.map((p) => (
            <div
              key={p.id}
              style={{
                background: 'var(--surface-card, #111827)',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                transition: 'transform 0.15s, border-color 0.15s',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: '17px', color: 'var(--text-primary)' }}>{p.name}</h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span
                        title={getPromptCategoryLabel(p.category)}
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: '#60a5fa',
                        }}
                      >
                        {p.category}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: 'var(--surface-raised, #1f2937)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {p.language}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: p.isActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: p.isActive ? '#4ade80' : '#f87171',
                          fontWeight: 600,
                        }}
                      >
                        {p.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownloadTxt(p)}
                    disabled={downloadingId === p.id}
                    title="Download .txt"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      color: 'var(--text-secondary)',
                      cursor: downloadingId === p.id ? 'wait' : 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {downloadingId === p.id ? '⏳' : '⬇️ .txt'}
                  </button>
                </div>

                {/* Template Monospace Box */}
                <div
                  style={{
                    background: 'var(--surface-raised, #0f172a)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color: '#e2e8f0',
                    fontFamily: 'monospace',
                    margin: '12px 0',
                    maxHeight: '120px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {p.promptText}
                </div>

                {/* Detected variables */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {TEMPLATE_VARIABLES.filter((v) => p.promptText.includes(v)).map((v) => (
                    <span
                      key={v}
                      style={{
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        background: 'rgba(168, 85, 247, 0.12)',
                        color: '#c084fc',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid var(--border)',
                  paddingTop: '12px',
                  marginTop: '4px',
                }}
              >
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handlePreview(p.promptText)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-raised, #1f2937)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    👁️ Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopy(p.promptText, p.id)
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: '1px solid var(--border)',
                      background: copiedId === p.id ? 'rgba(34, 197, 94, 0.2)' : 'var(--surface-raised, #1f2937)',
                      color: copiedId === p.id ? '#4ade80' : 'var(--text-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {copiedId === p.id ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(p)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => setDeleteTarget(p)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#f87171',
                      cursor: 'pointer',
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-prompt-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: 'var(--surface-card, #111827)',
              borderRadius: '14px',
              border: '1px solid var(--border)',
              width: '100%',
              maxWidth: '420px',
              padding: '24px',
            }}
          >
            <h2 id="delete-prompt-title" style={{ margin: '0 0 8px 0', fontSize: '17px', color: 'var(--text-primary)' }}>
              Delete Voice Prompt
            </h2>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Are you sure you want to delete &ldquo;{deleteTarget.name}&rdquo;? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  void handleConfirmDelete()
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#dc2626',
                  color: '#ffffff',
                  cursor: deleting ? 'wait' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {deleting ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: 'var(--surface-card, #111827)',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              width: '100%',
              maxWidth: '640px',
              padding: '28px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 id="prompt-modal-title" style={{ margin: 0, fontSize: '20px', color: 'var(--text-primary)' }}>
                {editingPrompt ? 'Edit Voice Prompt' : 'Create Voice Prompt'}
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setIsModalOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: '20px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div
                role="alert"
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #ef4444',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: '#fca5a5',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSavePrompt}>
              <div style={{ marginBottom: '16px' }}>
                <label htmlFor="prompt-name-input" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Prompt Name *
                </label>
                <input
                  id="prompt-name-input"
                  type="text"
                  required
                  placeholder="e.g. Friendly Payment Reminder"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-raised, #1f2937)',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label htmlFor="prompt-category-select" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Category
                  </label>
                  <select
                    id="prompt-category-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--surface-raised, #1f2937)',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <optgroup label="Chotu Voice Call Categories">
                      {CANONICAL_PROMPT_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label} ({c.id})
                        </option>
                      ))}
                    </optgroup>
                    {hasLegacyOrCustomCategory && (
                      <optgroup label="Existing / Legacy Category">
                        <option value={category}>{getPromptCategoryLabel(category)}</option>
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label htmlFor="prompt-language-select" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Language
                  </label>
                  <select
                    id="prompt-language-select"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--surface-raised, #1f2937)',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Hinglish">Hinglish</option>
                    <option value="en-IN">en-IN</option>
                  </select>
                </div>
              </div>

              {/* Variable Chips */}
              <div style={{ marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Click to insert dynamic variable:</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVariable(v)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border)',
                        background: 'rgba(59, 130, 246, 0.1)',
                        color: '#60a5fa',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                      }}
                    >
                      + {v}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label htmlFor="prompt-text-input" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Prompt Template Script *
                </label>
                <textarea
                  id="prompt-text-input"
                  required
                  rows={6}
                  placeholder="Namaste! This is Chotu calling regarding invoice {{invoiceNumber}} of {{outstandingAmount}}..."
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-raised, #1f2937)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    lineHeight: '1.5',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                <input
                  type="checkbox"
                  id="isActiveCheck"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="isActiveCheck" style={{ fontSize: '14px', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  Active (available in Chotu AI agent call sessions)
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--primary, #3b82f6)',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {saving ? 'Saving...' : editingPrompt ? 'Update Prompt' : 'Create Prompt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: 'var(--surface-card, #111827)',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              width: '100%',
              maxWidth: '600px',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>
                🎙️ Dynamic Speech Preview
              </h2>
              <button
                type="button"
                aria-label="Close preview"
                onClick={() => setPreviewModalOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: '20px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              This simulates how Chotu AI interpolates live invoice variables into natural spoken speech:
            </p>

            {previewError && (
              <div
                role="alert"
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #ef4444',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: '#fca5a5',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {previewError}
              </div>
            )}

            <div
              style={{
                background: 'var(--surface-raised, #0f172a)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '10px',
                padding: '16px',
                fontSize: '14px',
                lineHeight: '1.6',
                color: '#f8fafc',
                minHeight: '100px',
                marginBottom: '16px',
                whiteSpace: 'pre-wrap',
              }}
            >
              {previewLoading ? 'Interpolating variables...' : previewContent}
            </div>

            {previewVariables.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Detected Template Variables:</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {previewVariables.map((v) => (
                    <span key={v} style={{ fontSize: '11px', fontFamily: 'monospace', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', padding: '2px 6px', borderRadius: '4px' }}>
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--primary, #3b82f6)',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
