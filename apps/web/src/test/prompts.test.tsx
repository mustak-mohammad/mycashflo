import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import apiClient from '../api/client'
import { promptsApi } from '../api/prompts'
import VoicePromptsPage from '../pages/VoicePromptsPage'
import {
  CANONICAL_PROMPT_CATEGORIES,
  isPromptCompatibleWithCallType,
  isSupportedPromptCategory,
} from '../utils/promptCategories'
import type { VoicePrompt } from '../types'

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} as Record<string, string> } },
  },
}))

const mockedGet = vi.mocked(apiClient.get)
const mockedPost = vi.mocked(apiClient.post)
const mockedPatch = vi.mocked(apiClient.patch)
const mockedDelete = vi.mocked(apiClient.delete)

const SAMPLE_PROMPTS: VoicePrompt[] = [
  {
    id: 'prompt-col-1',
    name: 'Standard Polite AR Collection',
    description: '10-stage collection flow',
    promptText: 'Hello {{customerName}}, calling about {{outstandingAmount}}.',
    category: 'COLLECTIONS',
    language: 'en-IN',
    isActive: true,
    tenantId: 'tenant-1',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'prompt-leg-1',
    name: 'Legacy Gentle Reminder',
    description: 'Legacy template preserved in DB',
    promptText: 'Reminder for {{invoiceNumber}}.',
    category: 'REMINDER',
    language: 'English',
    isActive: true,
    tenantId: 'tenant-1',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
  },
]

describe('P2-04 Chotu Voice Prompts & Export Fixes', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>
  let anchorClickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-prompt-url')
    revokeObjectURLSpy = vi.fn()
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURLSpy,
    })
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURLSpy,
    })
    anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    anchorClickSpy.mockRestore()
  })

  it('calls canonical GET /prompts/:id/download endpoint and triggers browser download', async () => {
    mockedGet.mockResolvedValueOnce({
      data: new Blob(['Prompt: Standard Polite AR Collection\n'], { type: 'text/plain' }),
    })

    await promptsApi.downloadTxt('prompt-col-1', 'Standard Polite AR Collection')

    expect(mockedGet).toHaveBeenCalledWith('/prompts/prompt-col-1/download', {
      responseType: 'blob',
    })
    expect(mockedGet).not.toHaveBeenCalledWith('/prompts/prompt-col-1/export', expect.anything())
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(anchorClickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-prompt-url')
  })

  it('keeps shared canonical categories aligned with VoicePage call compatibility and preserves legacy categories', () => {
    const ids = CANONICAL_PROMPT_CATEGORIES.map((c) => c.id)
    expect(ids).toEqual(['COLLECTIONS', 'OVERDUE', 'COURTESY', 'DISPUTE', 'CALLBACK', 'LEGAL'])

    // Every canonical category is supported
    for (const id of ids) {
      expect(isSupportedPromptCategory(id)).toBe(true)
    }

    // Legacy categories remain supported and safely mapped for non-dispute call types
    for (const legacy of ['REMINDER', 'FINAL_NOTICE', 'PAYMENT_PLAN', 'CUSTOM']) {
      expect(isSupportedPromptCategory(legacy)).toBe(true)
      expect(isPromptCompatibleWithCallType(legacy, 'COLLECTIONS')).toBe(true)
      expect(isPromptCompatibleWithCallType(legacy, 'DISPUTE')).toBe(false)
    }

    // Strict DISPUTE isolation
    expect(isPromptCompatibleWithCallType('DISPUTE', 'DISPUTE')).toBe(true)
    expect(isPromptCompatibleWithCallType('DISPUTE', 'COLLECTIONS')).toBe(false)
    expect(isPromptCompatibleWithCallType('DISPUTE', 'CALLBACK')).toBe(false)
    expect(isPromptCompatibleWithCallType('COLLECTIONS', 'COLLECTIONS')).toBe(true)
    expect(isPromptCompatibleWithCallType('CALLBACK', 'CALLBACK')).toBe(true)
    expect(isSupportedPromptCategory('INVALID_CATEGORY')).toBe(false)
  })

  it('displays inline error when prompt download fails without using alert()', async () => {
    const user = userEvent.setup()
    mockedGet.mockImplementation((url: string) => {
      if (url === '/prompts') {
        return Promise.resolve({ data: SAMPLE_PROMPTS })
      }
      if (url === '/prompts/prompt-col-1/download') {
        return Promise.reject({ response: { status: 404 } })
      }
      return Promise.resolve({ data: [] })
    })

    render(<VoicePromptsPage />)

    await waitFor(() => {
      expect(screen.getByText('Standard Polite AR Collection')).toBeInTheDocument()
    })

    const downloadButtons = screen.getAllByTitle('Download .txt')
    await user.click(downloadButtons[0])

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/prompts/prompt-col-1/download', {
        responseType: 'blob',
      })
      expect(screen.getByRole('alert')).toHaveTextContent(/requested prompt could not be found/i)
    })
  })

  it('filters prompts using canonical categories and preserves legacy category when editing', async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue({ data: SAMPLE_PROMPTS })

    render(<VoicePromptsPage />)

    await waitFor(() => {
      expect(screen.getByText('Legacy Gentle Reminder')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Collections (10-Stage)' }))
    await waitFor(() => {
      expect(mockedGet).toHaveBeenLastCalledWith('/prompts', {
        params: { search: undefined, category: 'COLLECTIONS' },
      })
    })

    // Edit the legacy REMINDER prompt and ensure select retains REMINDER
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    await user.click(editButtons[1])

    const categorySelect = screen.getByLabelText(/category/i) as HTMLSelectElement
    expect(categorySelect.value).toBe('REMINDER')
  })

  it('preserves user input and shows clear modal error when prompt creation or editing fails', async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue({ data: SAMPLE_PROMPTS })
    mockedPost.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'Prompt name already exists in tenant' } },
    })
    mockedPatch.mockRejectedValueOnce({
      response: { status: 500, data: { message: 'Temporary database error' } },
    })

    render(<VoicePromptsPage />)
    await waitFor(() => {
      expect(screen.getByText('Standard Polite AR Collection')).toBeInTheDocument()
    })

    // 1. Create failure keeps modal open with user inputs intact
    await user.click(screen.getByRole('button', { name: /\+ create prompt/i }))

    const nameInput = screen.getByLabelText(/prompt name/i) as HTMLInputElement
    const scriptInput = screen.getByLabelText(/prompt template script/i) as HTMLTextAreaElement

    await user.type(nameInput, 'Callback Priority Script')
    await user.selectOptions(screen.getByLabelText(/category/i), 'CALLBACK')
    await user.type(scriptInput, 'Calling back regarding pending invoice.')
    await user.click(screen.getByRole('button', { name: /^create prompt$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Prompt name already exists in tenant')
    })
    expect(nameInput.value).toBe('Callback Priority Script')
    expect(scriptInput.value).toBe('Calling back regarding pending invoice.')
    expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe('CALLBACK')

    await user.click(screen.getByRole('button', { name: /close modal/i }))

    // 2. Edit failure preserves modified text inside modal
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    await user.click(editButtons[0])

    const editScriptInput = screen.getByLabelText(/prompt template script/i) as HTMLTextAreaElement
    await user.type(editScriptInput, ' Extra follow-up note.')
    await user.click(screen.getByRole('button', { name: /update prompt/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Temporary database error')
    })
    expect(editScriptInput.value).toContain('Extra follow-up note.')
  })

  it('displays clear error feedback on initial load failure and delete failure', async () => {
    const user = userEvent.setup()
    mockedGet.mockRejectedValueOnce(new Error('Network unavailable'))

    render(<VoicePromptsPage />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/unable to load voice prompts/i)
    })

    // Retry succeeds
    mockedGet.mockResolvedValueOnce({ data: SAMPLE_PROMPTS })
    await user.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(screen.getByText('Standard Polite AR Collection')).toBeInTheDocument()
    })

    // Delete failure shows inline feedback
    mockedDelete.mockRejectedValueOnce({
      response: { status: 403, data: { message: 'Only Admin/Manager can delete prompts' } },
    })

    await user.click(screen.getByRole('button', { name: 'Delete Standard Polite AR Collection' }))
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Only Admin/Manager can delete prompts')
    })
  })
})
