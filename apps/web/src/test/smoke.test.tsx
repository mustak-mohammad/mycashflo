import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatCard } from '../components/ui/StatCard'
import { PasswordInput } from '../components/ui/PasswordInput'

function SmokeInteractiveWidget() {
  const [note, setNote] = useState('')
  const [clicks, setClicks] = useState(0)

  return (
    <section aria-label="Smoke interactive widget">
      <h2>Frontend Smoke Check</h2>
      <label htmlFor="smoke-note-input">Reference note</label>
      <input
        id="smoke-note-input"
        type="text"
        placeholder="Enter reference note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p data-testid="note-preview">{note || 'Empty'}</p>
      <button type="button" onClick={() => setClicks((c) => c + 1)}>
        Acknowledge ({clicks})
      </button>
    </section>
  )
}

describe('Frontend testing foundation smoke tests', () => {
  it('renders an existing UI component with DOM assertions', () => {
    render(
      <StatCard
        label="Total Receivables"
        value="₹1,25,000"
        subtext="3 open invoices"
        icon="📈"
      />,
    )

    expect(screen.getByText('Total Receivables')).toBeInTheDocument()
    expect(screen.getByText('₹1,25,000')).toBeInTheDocument()
    expect(screen.getByText('3 open invoices')).toBeInTheDocument()
  })

  it('accepts typed text and toggles visibility button in PasswordInput', async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label="Workspace password" placeholder="Enter password" />)

    const input = screen.getByLabelText('Workspace password')
    expect(input).toHaveAttribute('type', 'password')

    await user.type(input, 'TestPass@2026')
    expect(input).toHaveValue('TestPass@2026')

    const toggleButton = screen.getByRole('button', { name: 'Show password' })
    await user.click(toggleButton)

    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
  })

  it('handles button clicks and live controlled input updates in a React component', async () => {
    const user = userEvent.setup()
    render(<SmokeInteractiveWidget />)

    expect(screen.getByRole('heading', { name: 'Frontend Smoke Check' })).toBeVisible()
    expect(screen.getByTestId('note-preview')).toHaveTextContent('Empty')

    const input = screen.getByLabelText('Reference note')
    await user.type(input, 'INV-2026-001')
    expect(input).toHaveValue('INV-2026-001')
    expect(screen.getByTestId('note-preview')).toHaveTextContent('INV-2026-001')

    const button = screen.getByRole('button', { name: 'Acknowledge (0)' })
    await user.click(button)
    await user.click(screen.getByRole('button', { name: 'Acknowledge (1)' }))
    expect(screen.getByRole('button', { name: 'Acknowledge (2)' })).toBeEnabled()
  })
})

