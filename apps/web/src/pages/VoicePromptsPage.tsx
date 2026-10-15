import { useState, useEffect } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { promptsApi } from '../api/prompts'
import type { VoicePrompt } from '../types'

const CATEGORIES = [
  { id: 'ALL', label: 'All Categories' },
  { id: 'REMINDER', label: 'Gentle Reminder' },
  { id: 'OVERDUE', label: 'Overdue Notice' },
  { id: 'FINAL_NOTICE', label: 'Final Urgent Notice' },
  { id: 'PAYMENT_PLAN', label: 'Payment Plan' },
  { id: 'CUSTOM', label: 'Custom' },
]

const TEMPLATE_VARIABLES = [
  '{{customerName}}',
  '{{outstandingAmount}}',
  '{{invoiceNumber}}',
  '{{dueDate}}',
  '{{companyName}}',
]

export default function VoicePromptsPage() {
  const [prompts, setPrompts] = useState<VoicePrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Create / Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<VoicePrompt | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('REMINDER')
  const [language, setLanguage] = useState('English')
  const [promptText, setPromptText] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewContent, setPreviewContent] = useState('')
  const [previewVariables, setPreviewVariables] = useState<string[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  // Load prompts
  const loadPrompts = async () => {
    try {
      setLoading(true)
      const data = await promptsApi.list({
        search: search || undefined,
        category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
      })
      setPrompts(data)
    } catch (err: any) {
      console.error('Failed to load voice prompts:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPrompts()
  }, [categoryFilter])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    loadPrompts()
  }

  const handleOpenCreate = () => {
    setEditingPrompt(null)
    setName('')
    setCategory('REMINDER')
    setLanguage('English')
    setPromptText('')
    setIsActive(true)
    setErrorMsg('')
    setIsModalOpen(true)
  }

  const handleOpenEdit = (p: VoicePrompt) => {
    setEditingPrompt(p)
    setName(p.name)
    setCategory(p.category)
    setLanguage(p.language)
    setPromptText(p.promptText)
    setIsActive(p.isActive)
    setErrorMsg('')
    setIsModalOpen(true)
  }

  const handleSavePrompt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !promptText.trim()) {
      setErrorMsg('Name and Prompt Template text are required.')
      return
    }

    try {
      setSaving(true)
      setErrorMsg('')
      if (editingPrompt) {
        await promptsApi.update(editingPrompt.id, {
          name,
          category,
          language,
          promptText,
          isActive,
        })
      } else {
        await promptsApi.create({
          name,
          category,
          language,
          promptText,
          isActive,
        })
      }
      setIsModalOpen(false)
      loadPrompts()
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || 'Failed to save prompt.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (p: VoicePrompt) => {
    if (!window.confirm(`Are you sure you want to delete "${p.name}"?`)) return
    try {
      await promptsApi.delete(p.id)
      setPrompts((prev) => prev.filter((item) => item.id !== p.id))
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to delete prompt.')
    }
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handlePreview = async (template: string) => {
    try {
      setPreviewLoading(true)
      setPreviewModalOpen(true)
      const res = await promptsApi.preview(template)
      setPreviewContent(res.preview)
      setPreviewVariables(res.missingVariables)
    } catch (err: any) {
      setPreviewContent('Error rendering preview: ' + (err?.message || 'Unknown error'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleDownloadTxt = async (p: VoicePrompt) => {
    try {
      await promptsApi.downloadTxt(p.id, p.name)
    } catch (err: any) {
      alert('Failed to download prompt: ' + (err?.message || 'Unknown error'))
    }
  }

  const handleDownloadZip = async () => {
    try {
      await promptsApi.downloadZip()
    } catch (err: any) {
      alert('Failed to download zip archive: ' + (err?.message || 'Unknown error'))
    }
  }

  const insertVariable = (varName: string) => {
    setPromptText((prev) => prev + (prev.endsWith(' ') || prev.length === 0 ? '' : ' ') + varName)
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <PageHeader
          title="Voice Prompts & Templates"
          subtitle="Create, customize, and export structured Chotu AI collection prompts with dynamic accounting variables."
        />
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleDownloadZip}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface-raised, #1e293b)',
              color: 'var(--text-primary, #f8fafc)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            📦 Download All (.zip)
          </button>
          <button
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
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
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

      {/* Prompts Cards Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
          Loading saved voice prompts...
        </div>
      ) : prompts.length === 0 ? (
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
            Get started by creating a customized collection script or resetting default templates.
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
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span
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
                    onClick={() => handleDownloadTxt(p)}
                    title="Download .txt"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    ⬇️ .txt
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
                    onClick={() => handleCopy(p.promptText, p.id)}
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
                    onClick={() => handleDelete(p)}
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

      {/* Create / Edit Modal */}
      {isModalOpen && (
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
              maxWidth: '640px',
              padding: '28px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--text-primary)' }}>
                {editingPrompt ? 'Edit Voice Prompt' : 'Create Voice Prompt'}
              </h2>
              <button
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
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Prompt Name *
                </label>
                <input
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
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Category
                  </label>
                  <select
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
                    <option value="REMINDER">Gentle Reminder</option>
                    <option value="OVERDUE">Overdue Notice</option>
                    <option value="FINAL_NOTICE">Final Urgent Notice</option>
                    <option value="PAYMENT_PLAN">Payment Plan</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Language
                  </label>
                  <select
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
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Prompt Template Script *
                </label>
                <textarea
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
